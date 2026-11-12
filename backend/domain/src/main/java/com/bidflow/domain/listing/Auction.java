package com.bidflow.domain.listing;

import java.time.Instant;
import java.util.UUID;

public record Auction(
        UUID auctionId,
        UUID productId,
        String sellerId,
        AuctionStatus status,
        long startingPrice,
        long currentPrice,
        Instant startsAt,
        Instant endsAt,
        long version
) {
}
