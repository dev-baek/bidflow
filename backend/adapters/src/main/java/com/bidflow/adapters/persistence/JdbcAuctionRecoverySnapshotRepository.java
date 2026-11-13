package com.bidflow.adapters.persistence;

import com.bidflow.application.bid.AutoBidMaximum;
import com.bidflow.application.bid.AuctionRecoverySnapshot;
import com.bidflow.application.bid.AuctionRecoverySnapshotRepository;
import com.bidflow.domain.listing.AuctionStatus;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;

/** Reads one auction and its durable automatic-bid maxima for Redis reconstruction. */
public final class JdbcAuctionRecoverySnapshotRepository implements AuctionRecoverySnapshotRepository {
    private final JdbcTemplate jdbc;

    public JdbcAuctionRecoverySnapshotRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public Optional<AuctionRecoverySnapshot> findByAuctionId(UUID auctionId) {
        List<RecoveryRow> rows = jdbc.query("""
                select a.auction_id, a.status, a.current_price, a.current_winner_id, a.starts_at, a.ends_at, a.version,
                       coalesce(m.maximum, a.current_price) as winner_maximum
                from auction a
                left join auto_bid_maximum m on m.auction_id = a.auction_id and m.bidder_id = a.current_winner_id
                where a.auction_id = ?
                """, (resultSet, rowNum) -> new RecoveryRow(
                resultSet.getObject("auction_id", UUID.class), AuctionStatus.valueOf(resultSet.getString("status")),
                resultSet.getLong("current_price"), resultSet.getString("current_winner_id"), resultSet.getLong("winner_maximum"),
                resultSet.getTimestamp("starts_at").toInstant(), resultSet.getTimestamp("ends_at").toInstant(), resultSet.getLong("version")), auctionId);
        return rows.stream().findFirst().map(row -> new AuctionRecoverySnapshot(row.auctionId(), row.status(), row.currentPrice(),
                row.winnerId(), row.winnerMaximum(), row.startsAt(), row.endsAt(), row.version(), maxima(auctionId)));
    }

    private List<AutoBidMaximum> maxima(UUID auctionId) {
        return jdbc.query("""
                select auction_id, bidder_id, maximum from auto_bid_maximum where auction_id = ?
                """, (resultSet, rowNum) -> new AutoBidMaximum(resultSet.getObject("auction_id", UUID.class),
                resultSet.getString("bidder_id"), resultSet.getLong("maximum")), auctionId);
    }

    private record RecoveryRow(UUID auctionId, AuctionStatus status, long currentPrice, String winnerId, long winnerMaximum,
                               java.time.Instant startsAt, java.time.Instant endsAt, long version) {
    }
}
