package com.bidflow.application.search;

import java.time.Instant;
import java.util.UUID;

public record ProductSearchDocument(
        UUID productId,
        UUID auctionId,
        String sellerId,
        String title,
        String categoryId,
        String conditionGrade,
        String thumbnailObjectKey,
        long startingPrice,
        long currentPrice,
        String status,
        boolean searchable,
        Instant startsAt,
        Instant endsAt,
        long listingVersion,
        long auctionVersion,
        Instant indexedAt
) {
}
