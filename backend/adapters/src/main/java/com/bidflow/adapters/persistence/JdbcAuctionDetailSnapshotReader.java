package com.bidflow.adapters.persistence;

import com.bidflow.application.auction.AuctionDetailSnapshot;
import com.bidflow.application.auction.AuctionDetailSnapshotReader;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;

/** Reads only the public auction projection from the PostgreSQL source of truth. */
public final class JdbcAuctionDetailSnapshotReader implements AuctionDetailSnapshotReader {
    private final JdbcTemplate jdbc;

    public JdbcAuctionDetailSnapshotReader(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public Optional<AuctionDetailSnapshot> findByAuctionId(UUID auctionId) {
        return jdbc.query("""
                select a.auction_id, p.title,
                       (select object_key from product_image where product_id = p.product_id order by display_order limit 1) as thumbnail_object_key,
                       a.current_price, a.ends_at, a.status, a.version, r.outcome, r.final_price
                  from auction a
                  join product p on p.product_id = a.product_id
             left join auction_result r on r.auction_id = a.auction_id
                 where a.auction_id = ?
                """, resultSet -> resultSet.next()
                ? Optional.of(new AuctionDetailSnapshot(
                        resultSet.getObject("auction_id", UUID.class), resultSet.getString("title"),
                        resultSet.getString("thumbnail_object_key"), resultSet.getLong("current_price"),
                        resultSet.getTimestamp("ends_at").toInstant(), resultSet.getString("status"),
                        resultSet.getLong("version"), resultSet.getString("outcome"),
                        resultSet.getObject("final_price", Long.class)))
                : Optional.empty(), auctionId);
    }
}
