package com.bidflow.application.auction;

import java.time.Instant;
import java.util.UUID;

/** Public PostgreSQL-backed auction state. Bidder identity and maximum bids are deliberately absent. */
public record AuctionDetailSnapshot(UUID auctionId, String title, boolean hasThumbnail, long currentPrice,
        Instant endsAt, String status, long auctionVersion, String outcome, Long finalPrice) {
}
