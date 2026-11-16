package com.bidflow.application.search;

import java.time.Instant;
import java.util.UUID;

public record SearchListingItem(
        UUID productId,
        UUID auctionId,
        String title,
        String categoryId,
        String thumbnailObjectKey,
        long currentPrice,
        String status,
        Instant endsAt
) {
}
