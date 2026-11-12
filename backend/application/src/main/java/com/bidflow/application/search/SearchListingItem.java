package com.bidflow.application.search;

import java.time.Instant;
import java.util.UUID;

public record SearchListingItem(
        UUID productId,
        String title,
        String categoryId,
        String thumbnailObjectKey,
        long currentPrice,
        String status,
        Instant endsAt
) {
}
