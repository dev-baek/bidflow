package com.bidflow.adapters.persistence;

import com.bidflow.application.bid.BidLedgerRepository;
import com.bidflow.application.bid.BidSettlementCommand;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import java.util.function.Supplier;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.support.TransactionTemplate;

/** PostgreSQL ledger adapter. A new ledger row gates all dependent writes in one transaction. */
public final class JdbcBidLedgerRepository implements BidLedgerRepository {
    private final JdbcTemplate jdbc;
    private final TransactionTemplate transaction;
    private final ObjectMapper objectMapper;
    private final Supplier<UUID> ids;

    public JdbcBidLedgerRepository(JdbcTemplate jdbc, TransactionTemplate transaction, ObjectMapper objectMapper, Supplier<UUID> ids) {
        this.jdbc = jdbc;
        this.transaction = transaction;
        this.objectMapper = objectMapper;
        this.ids = ids;
    }

    @Override
    public boolean persist(BidSettlementCommand command) {
        Boolean persisted = transaction.execute(status -> persistInTransaction(command));
        return Boolean.TRUE.equals(persisted);
    }

    private boolean persistInTransaction(BidSettlementCommand command) {
        int inserted = jdbc.update("""
                insert into bid_ledger (bid_ledger_id, bid_request_id, auction_id, bidder_id, decision, requested_amount, current_price, rejection_reason, decided_at)
                values (?, ?, ?, ?, ?, ?, ?, ?, ?)
                on conflict (bid_request_id) do nothing
                """, ids.get(), command.bidRequestId(), command.auctionId(), command.bidderId(),
                command.accepted() ? "ACCEPTED" : "REJECTED", command.requestedAmount(),
                command.accepted() ? command.result().currentPrice() : null,
                command.accepted() ? null : command.result().code().name(), Timestamp.from(command.processedAt()));
        if (inserted == 0) {
            return false;
        }

        int requestUpdated = jdbc.update("""
                update bid_request set status = ?, processed_at = ?
                where bid_request_id = ? and status = 'RECEIVED'
                """, command.accepted() ? "ACCEPTED" : "REJECTED", Timestamp.from(command.processedAt()), command.bidRequestId());
        if (requestUpdated != 1) {
            throw new IllegalStateException("bid request was not in RECEIVED state");
        }

        if (command.accepted()) {
            AuctionSnapshot before = jdbc.queryForObject("""
                    select ends_at, version from auction where auction_id = ? for update
                    """, (resultSet, rowNum) -> new AuctionSnapshot(
                    resultSet.getTimestamp("ends_at").toInstant(), resultSet.getLong("version")), command.auctionId());
            if (before == null || before.version() != command.result().version() - 1) {
                throw new IllegalStateException("auction version does not match the Lua decision");
            }
            int auctionUpdated = jdbc.update("""
                    update auction
                    set status = 'ACTIVE', current_price = ?, ends_at = ?, version = ?, updated_at = ?
                    where auction_id = ? and version = ?
                    """, command.result().currentPrice(), Timestamp.from(command.result().endsAt()), command.result().version(),
                    Timestamp.from(command.processedAt()), command.auctionId(), before.version());
            if (auctionUpdated != 1) {
                throw new IllegalStateException("auction update did not apply");
            }
            insertOutbox(command, "BidAccepted", acceptedPayload(command));
            if (!before.endsAt().equals(command.result().endsAt())) {
                insertOutbox(command, "AuctionExtended", extensionPayload(command, before.endsAt()));
            }
        } else {
            insertOutbox(command, "BidRejected", rejectedPayload(command));
        }
        return true;
    }

    private void insertOutbox(BidSettlementCommand command, String eventType, String payload) {
        jdbc.update("""
                insert into outbox_event (event_id, aggregate_type, aggregate_id, topic, partition_key, correlation_id, event_type, schema_version, payload, occurred_at)
                values (?, 'Auction', ?, 'bid-event', ?, ?, ?, 1, cast(? as jsonb), ?)
                """, ids.get(), command.auctionId(), command.auctionId().toString(), command.correlationId(), eventType, payload,
                Timestamp.from(command.processedAt()));
    }

    private String acceptedPayload(BidSettlementCommand command) {
        Map<String, Object> payload = basePayload(command);
        payload.put("currentPrice", command.result().currentPrice());
        payload.put("auctionVersion", command.result().version());
        payload.put("processedAt", command.processedAt().toString());
        payload.put("endsAt", command.result().endsAt().toString());
        payload.put("isHighestBidder", command.bidderId().equals(command.result().winnerId()));
        return json(payload);
    }

    private String rejectedPayload(BidSettlementCommand command) {
        Map<String, Object> payload = basePayload(command);
        payload.put("reason", command.result().code().name());
        payload.put("auctionVersion", command.result().version());
        payload.put("processedAt", command.processedAt().toString());
        return json(payload);
    }

    private String extensionPayload(BidSettlementCommand command, Instant previousEndsAt) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("auctionId", command.auctionId().toString());
        payload.put("previousEndsAt", previousEndsAt.toString());
        payload.put("extendedEndsAt", command.result().endsAt().toString());
        payload.put("auctionVersion", command.result().version());
        return json(payload);
    }

    private static Map<String, Object> basePayload(BidSettlementCommand command) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("bidRequestId", command.bidRequestId().toString());
        payload.put("auctionId", command.auctionId().toString());
        payload.put("bidderId", command.bidderId());
        return payload;
    }

    private String json(Map<String, Object> payload) {
        try {
            return objectMapper.writeValueAsString(payload);
        } catch (JsonProcessingException exception) {
            throw new IllegalStateException("bid event payload serialization failed", exception);
        }
    }

    private record AuctionSnapshot(Instant endsAt, long version) {
    }
}
