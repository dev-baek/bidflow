package com.bidflow.adapters.persistence;

import com.bidflow.application.bid.BidRequestCommand;
import com.bidflow.application.bid.BidRequestRepository;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.support.TransactionTemplate;

public final class JdbcBidRequestRepository implements BidRequestRepository {
    private final JdbcTemplate jdbc;
    private final TransactionTemplate tx;

    public JdbcBidRequestRepository(JdbcTemplate jdbc, TransactionTemplate tx) {
        this.jdbc = jdbc;
        this.tx = tx;
    }

    @Override
    public Optional<UUID> find(String bidder, String key, String hash) {
        return jdbc.query("""
                select bid_request_id from bid_request where bidder_id = ? and idempotency_key = ? and payload_hash = ?
                """, rs -> rs.next() ? Optional.of(rs.getObject(1, UUID.class)) : Optional.empty(), bidder, key, hash);
    }

    @Override
    public boolean saveIfAbsent(String bidder, String key, String hash, String correlationId, UUID id, BidRequestCommand command) {
        return Boolean.TRUE.equals(tx.execute(status -> {
            Instant requestedAt = Instant.now();
            int inserted = jdbc.update("""
                    insert into bid_request (bid_request_id, auction_id, bidder_id, bid_kind, amount, status,
                        requested_at, correlation_id, idempotency_key, payload_hash)
                    values (?, ?, ?, ?, ?, 'RECEIVED', ?, ?, ?, ?)
                    on conflict (bidder_id, idempotency_key) where idempotency_key is not null do nothing
                    """, id, command.auctionId(), bidder, command.bidKind(), command.amount(),
                    Timestamp.from(requestedAt), correlationId, key, hash);
            if (inserted == 0) return false;

            jdbc.update("""
                    insert into outbox_event (event_id, aggregate_type, aggregate_id, topic, partition_key, correlation_id,
                        event_type, schema_version, payload, occurred_at)
                    values (?, 'Auction', ?, 'bid-command', ?, ?, 'BidCommandRequested', 1,
                        jsonb_build_object('bidRequestId', cast(? as uuid), 'auctionId', cast(? as uuid),
                            'bidderId', cast(? as text), 'bidKind', cast(? as text), 'amount', cast(? as bigint),
                            'requestedAt', cast(? as text)), ?)
                    """, UUID.randomUUID(), command.auctionId(), command.auctionId().toString(), correlationId,
                    id, command.auctionId(), bidder, command.bidKind(), command.amount(), requestedAt.toString(),
                    Timestamp.from(requestedAt));
            return true;
        }));
    }
}
