package com.bidflow.adapters.persistence;

import com.bidflow.application.auction.PrivateAuctionOutcome;
import com.bidflow.application.auction.PrivateAuctionOutcomeReader;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;

public final class JdbcPrivateAuctionOutcomeReader implements PrivateAuctionOutcomeReader {
    private final JdbcTemplate jdbc;

    public JdbcPrivateAuctionOutcomeReader(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public Optional<PrivateAuctionOutcome> findForViewer(UUID auctionId, String viewerId) {
        return jdbc.query("""
                select a.status, r.outcome, coalesce(r.winner_id = ?, false) as viewer_won,
                       exists (select 1 from bid_ledger b
                               where b.auction_id = a.auction_id and b.bidder_id = ? and b.decision = 'ACCEPTED') as accepted_bid
                  from auction a
             left join auction_result r on r.auction_id = a.auction_id
                 where a.auction_id = ?
                """, row -> row.next() ? Optional.of(PrivateAuctionOutcome.classify(
                row.getString("status"), row.getString("outcome"), row.getBoolean("accepted_bid"),
                row.getBoolean("viewer_won"))) : Optional.empty(), viewerId, viewerId, auctionId);
    }
}
