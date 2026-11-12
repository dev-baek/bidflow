package com.bidflow.application.bid;

import com.bidflow.domain.listing.AuctionStatus;
import java.time.Instant;
import java.util.UUID;

/** Active auction state mirrored in Redis; PostgreSQL remains the durable source of truth. */
public record AuctionRedisState(
        UUID auctionId,
        AuctionStatus status,
        long currentPrice,
        String winnerId,
        long winnerMaximum,
        Instant startsAt,
        Instant endsAt,
        long version
) {
}
