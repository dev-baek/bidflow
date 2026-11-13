package com.bidflow.adapters.persistence;

import com.bidflow.application.bid.AutoBidMaximum;
import com.bidflow.application.bid.AutoBidMaximumRepository;
import java.sql.Timestamp;
import java.time.Clock;
import java.time.Instant;
import org.springframework.jdbc.core.JdbcTemplate;

/** Stores the private maximum independently of the ephemeral Redis sorted set. */
public final class JdbcAutoBidMaximumRepository implements AutoBidMaximumRepository {
    private final JdbcTemplate jdbc;
    private final Clock clock;

    public JdbcAutoBidMaximumRepository(JdbcTemplate jdbc, Clock clock) {
        this.jdbc = jdbc;
        this.clock = clock;
    }

    @Override
    public void save(AutoBidMaximum maximum) {
        jdbc.update("""
                insert into auto_bid_maximum (auction_id, bidder_id, maximum, updated_at)
                values (?, ?, ?, ?)
                on conflict (auction_id, bidder_id) do update
                set maximum = greatest(auto_bid_maximum.maximum, excluded.maximum), updated_at = excluded.updated_at
                """, maximum.auctionId(), maximum.bidderId(), maximum.maximum(), Timestamp.from(Instant.now(clock)));
    }
}
