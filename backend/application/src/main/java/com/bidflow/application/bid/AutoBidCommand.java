package com.bidflow.application.bid;

import java.time.Instant;
import java.util.Objects;
import java.util.UUID;

/** Server-side request to register or raise a private automatic-bid maximum. */
public record AutoBidCommand(UUID bidRequestId, UUID auctionId, String bidderId, long maximum, Instant now) {
    public AutoBidCommand {
        Objects.requireNonNull(bidRequestId, "bidRequestId must not be null");
        Objects.requireNonNull(auctionId, "auctionId must not be null");
        Objects.requireNonNull(now, "now must not be null");
        if (bidderId == null || bidderId.isBlank()) throw new IllegalArgumentException("bidderId must not be blank");
        if (maximum < 1_000L) throw new IllegalArgumentException("maximum must be at least 1000");
    }
}
