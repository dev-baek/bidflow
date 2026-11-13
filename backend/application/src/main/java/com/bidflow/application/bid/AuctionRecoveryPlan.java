package com.bidflow.application.bid;

import com.bidflow.domain.listing.AuctionStatus;
import java.time.Duration;
import java.time.Instant;

/** Pure decision for restoring one Redis auction projection from PostgreSQL. */
public record AuctionRecoveryPlan(AuctionRedisState state, Duration ttl, boolean ended) {
    private static final Duration REPLAY_RETENTION = Duration.ofHours(24);

    public static AuctionRecoveryPlan from(AuctionRecoverySnapshot snapshot, Instant now) {
        if (snapshot.status() == AuctionStatus.ENDED || snapshot.status() == AuctionStatus.CANCELLED || !snapshot.endsAt().isAfter(now)) {
            return new AuctionRecoveryPlan(null, Duration.ZERO, true);
        }
        AuctionRedisState state = new AuctionRedisState(snapshot.auctionId(), snapshot.status(), snapshot.currentPrice(),
                snapshot.winnerId() == null ? "" : snapshot.winnerId(), snapshot.winnerMaximum(), snapshot.startsAt(), snapshot.endsAt(), snapshot.version());
        return new AuctionRecoveryPlan(state, Duration.between(now, snapshot.endsAt()).plus(REPLAY_RETENTION), false);
    }
}
