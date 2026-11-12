package com.bidflow.domain.listing;

import java.time.Instant;
import java.util.UUID;

public record AuctionDraft(
        UUID auctionId,
        UUID productId,
        String sellerId,
        long startingPrice,
        Instant startsAt,
        Instant endsAt
) {
}
