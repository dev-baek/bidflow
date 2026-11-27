package com.bidflow.adapters.persistence;

import com.bidflow.application.bid.BidLedgerRepository;
import com.bidflow.application.bid.DirectBidResultCode;
import com.bidflow.application.bid.BidSettlementCommand;
import com.bidflow.domain.listing.AuctionStatus;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
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
    public Optional<DirectBidResultCode> persist(BidSettlementCommand command) {
        return Optional.ofNullable(transaction.execute(status -> persistInTransaction(command)));
    }

    private DirectBidResultCode persistInTransaction(BidSettlementCommand command) {
        AuctionSnapshot before = command.accepted() ? lockAuction(command.auctionId()) : null;
        boolean endedBeforeSettlement = before != null && before.status() == AuctionStatus.ENDED;
        DirectBidResultCode decision = endedBeforeSettlement ? DirectBidResultCode.AUCTION_ENDED : command.result().code();
        boolean accepted = decision == DirectBidResultCode.ACCEPTED;
        int inserted = jdbc.update("""
                insert into bid_ledger (bid_ledger_id, bid_request_id, auction_id, bidder_id, decision, requested_amount, current_price, rejection_reason, decided_at)
                values (?, ?, ?, ?, ?, ?, ?, ?, ?)
                on conflict (bid_request_id) do nothing
                """, ids.get(), command.bidRequestId(), command.auctionId(), command.bidderId(),
                accepted ? "ACCEPTED" : "REJECTED", command.requestedAmount(),
                accepted ? command.result().currentPrice() : null,
                accepted ? null : decision.name(), Timestamp.from(command.processedAt()));
        if (inserted == 0) {
            return null;
        }

        int requestUpdated = jdbc.update("""
                update bid_request set status = ?, processed_at = ?
                where bid_request_id = ? and status = 'RECEIVED'
                """, accepted ? "ACCEPTED" : "REJECTED", Timestamp.from(command.processedAt()), command.bidRequestId());
        if (requestUpdated != 1) {
            throw new IllegalStateException("bid request was not in RECEIVED state");
        }

        if (accepted) {
            if (before == null || (before.status() != AuctionStatus.SCHEDULED && before.status() != AuctionStatus.ACTIVE)
                    || before.version() != command.result().version() - 1) {
                throw new IllegalStateException("auction version does not match the Lua decision");
            }
            int auctionUpdated = jdbc.update("""
                    update auction
                    set status = 'ACTIVE', current_price = ?, current_winner_id = ?, effective_winner_maximum = ?, ends_at = ?, version = ?, updated_at = ?
                    where auction_id = ? and version = ?
                    """, command.result().currentPrice(), command.result().winnerId(), command.result().winnerMaximum(),
                    Timestamp.from(command.result().endsAt()), command.result().version(),
                    Timestamp.from(command.processedAt()), command.auctionId(), before.version());
            if (auctionUpdated != 1) {
                throw new IllegalStateException("auction update did not apply");
            }
            insertOutbox(command, "BidAccepted", acceptedPayload(command));
            if (!before.endsAt().equals(command.result().endsAt())) {
                insertOutbox(command, "AuctionExtended", extensionPayload(command, before.endsAt()));
            }
        } else {
            long version = endedBeforeSettlement ? before.version() : command.result().version();
            insertOutbox(command, "BidRejected", rejectedPayload(command, decision, version));
        }
        return decision;
    }

    private AuctionSnapshot lockAuction(UUID auctionId) {
        // Exclude close/settlement writers without blocking FK checks for ledger inserts.
        return jdbc.queryForObject("""
                select status, ends_at, version from auction where auction_id = ? for no key update
                """, (resultSet, rowNum) -> new AuctionSnapshot(AuctionStatus.valueOf(resultSet.getString("status")),
                resultSet.getTimestamp("ends_at").toInstant(), resultSet.getLong("version")), auctionId);
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

    private String rejectedPayload(BidSettlementCommand command, DirectBidResultCode decision, long version) {
        Map<String, Object> payload = basePayload(command);
        payload.put("reason", decision.name());
        payload.put("auctionVersion", version);
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

    private record AuctionSnapshot(AuctionStatus status, Instant endsAt, long version) {
    }
}
