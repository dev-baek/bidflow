package com.bidflow.application.bid;

import com.bidflow.domain.listing.AuctionStatus;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/** Durable auction data necessary to restore one Redis active-auction projection. */
public record AuctionRecoverySnapshot(
        UUID auctionId,
        AuctionStatus status,
        long currentPrice,
        String winnerId,
        long winnerMaximum,
        Instant startsAt,
        Instant endsAt,
        long version,
        List<AutoBidMaximum> automaticMaxima) {
}
