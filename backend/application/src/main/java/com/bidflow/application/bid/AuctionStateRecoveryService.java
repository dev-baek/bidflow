package com.bidflow.application.bid;

import com.bidflow.application.auction.AuctionActiveStateCleaner;
import java.time.Instant;
import java.util.UUID;

/** Imperative shell that restores only the Redis keys for the auction currently being retried. */
public final class AuctionStateRecoveryService {
    private final AuctionRecoverySnapshotRepository snapshots;
    private final AuctionStateRepository states;
    private final AuctionActiveStateCleaner cleaner;

    public AuctionStateRecoveryService(AuctionRecoverySnapshotRepository snapshots, AuctionStateRepository states,
            AuctionActiveStateCleaner cleaner) {
        this.snapshots = snapshots;
        this.states = states;
        this.cleaner = cleaner;
    }

    public AuctionRecoveryResult recover(UUID auctionId, Instant now) {
        AuctionRecoverySnapshot snapshot = snapshots.findByAuctionId(auctionId)
                .orElseThrow(() -> new IllegalStateException("auction recovery snapshot is unavailable"));
        AuctionRecoveryPlan plan = AuctionRecoveryPlan.from(snapshot, now);
        if (plan.ended()) {
            cleaner.clear(auctionId);
            return new AuctionRecoveryResult(snapshot, false);
        }
        states.save(plan.state(), plan.ttl());
        snapshot.automaticMaxima().forEach(maximum -> states.saveAutoMaximum(
                maximum.auctionId(), maximum.bidderId(), maximum.maximum(), plan.ttl()));
        return new AuctionRecoveryResult(snapshot, true);
    }
}
