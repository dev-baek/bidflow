package com.bidflow.adapters.persistence;

import com.bidflow.application.realtime.AuctionRealtimeSnapshot;
import com.bidflow.application.realtime.AuctionRealtimeSnapshotReader;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;

/** Reads the authoritative PostgreSQL Snapshot; Redis and Kafka payloads are not used as public state. */
public final class JdbcAuctionRealtimeSnapshotReader implements AuctionRealtimeSnapshotReader {
    private final JdbcTemplate jdbc;

    public JdbcAuctionRealtimeSnapshotReader(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public Optional<AuctionRealtimeSnapshot> findByAuctionId(UUID auctionId) {
        return jdbc.query("""
                select auction_id, current_price, ends_at, status, version from auction where auction_id = ?
                """, resultSet -> resultSet.next()
                ? Optional.of(new AuctionRealtimeSnapshot(
                        resultSet.getObject("auction_id", UUID.class), resultSet.getLong("current_price"),
                        resultSet.getTimestamp("ends_at").toInstant(), resultSet.getString("status"), resultSet.getLong("version")))
                : Optional.empty(), auctionId);
    }
}
