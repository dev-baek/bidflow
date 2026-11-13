package com.bidflow.adapters.persistence;

import com.bidflow.application.auction.AuctionCloseRepository;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Supplier;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.support.TransactionTemplate;

/** Uses PostgreSQL row locks to make terminal auction state and its Outbox event one durable operation. */
public final class JdbcAuctionCloseRepository implements AuctionCloseRepository {
    private final JdbcTemplate jdbc;
    private final TransactionTemplate transaction;
    private final ObjectMapper objectMapper;
    private final Supplier<UUID> ids;

    public JdbcAuctionCloseRepository(JdbcTemplate jdbc, TransactionTemplate transaction, ObjectMapper objectMapper, Supplier<UUID> ids) {
        this.jdbc = jdbc;
        this.transaction = transaction;
        this.objectMapper = objectMapper;
        this.ids = ids;
    }

    @Override
    public int closeExpired(Instant now, int batchSize) {
        if (now == null || batchSize < 1) throw new IllegalArgumentException("now and positive batchSize are required");
        Integer count = transaction.execute(status -> closeInTransaction(now, batchSize));
        return count == null ? 0 : count;
    }

    private int closeInTransaction(Instant now, int batchSize) {
        List<ExpiredAuction> auctions = jdbc.query("""
                select auction_id, current_price, current_winner_id, version
                from auction
                where status = 'ACTIVE' and ends_at <= ?
                order by ends_at
                for update skip locked
                limit ?
                """, (resultSet, rowNum) -> new ExpiredAuction(
                resultSet.getObject("auction_id", UUID.class), resultSet.getLong("current_price"),
                resultSet.getString("current_winner_id"), resultSet.getLong("version")), Timestamp.from(now), batchSize);
        for (ExpiredAuction auction : auctions) close(auction, now);
        return auctions.size();
    }

    private void close(ExpiredAuction auction, Instant now) {
        boolean sold = auction.winnerId() != null && !auction.winnerId().isBlank();
        long nextVersion = auction.version() + 1;
        int updated = jdbc.update("""
                update auction set status = 'ENDED', version = ?, updated_at = ?
                where auction_id = ? and status = 'ACTIVE' and version = ?
                """, nextVersion, Timestamp.from(now), auction.auctionId(), auction.version());
        if (updated != 1) throw new IllegalStateException("locked auction could not be ended");
        jdbc.update("""
                insert into auction_result (auction_id, outcome, winner_id, final_price, determined_at)
                values (?, ?, ?, ?, ?)
                """, auction.auctionId(), sold ? "SOLD" : "UNSOLD", sold ? auction.winnerId() : null,
                sold ? auction.currentPrice() : null, Timestamp.from(now));
        jdbc.update("""
                insert into outbox_event (event_id, aggregate_type, aggregate_id, topic, partition_key, correlation_id, event_type, schema_version, payload, occurred_at)
                values (?, 'Auction', ?, 'bid-event', ?, ?, 'AuctionEnded', 1, cast(? as jsonb), ?)
                """, ids.get(), auction.auctionId(), auction.auctionId().toString(), auction.auctionId().toString(),
                endedPayload(auction, sold, nextVersion, now), Timestamp.from(now));
    }

    private String endedPayload(ExpiredAuction auction, boolean sold, long version, Instant now) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("auctionId", auction.auctionId().toString());
        payload.put("outcome", sold ? "SOLD" : "UNSOLD");
        payload.put("winnerId", sold ? auction.winnerId() : null);
        payload.put("finalPrice", sold ? auction.currentPrice() : null);
        payload.put("auctionVersion", version);
        payload.put("endedAt", now.toString());
        try {
            return objectMapper.writeValueAsString(payload);
        } catch (JsonProcessingException exception) {
            throw new IllegalStateException("auction ended payload serialization failed", exception);
        }
    }

    private record ExpiredAuction(UUID auctionId, long currentPrice, String winnerId, long version) {
    }
}
