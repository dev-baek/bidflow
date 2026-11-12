package com.bidflow.application.bid;

import java.time.Instant;
import java.util.Objects;
import java.util.UUID;

/** Input supplied by the Worker; {@code now} is a server-side Clock value, never browser time. */
public record DirectBidCommand(UUID bidRequestId, UUID auctionId, String bidderId, long amount, Instant now) {
    public DirectBidCommand {
        Objects.requireNonNull(bidRequestId, "bidRequestId must not be null");
        Objects.requireNonNull(auctionId, "auctionId must not be null");
        Objects.requireNonNull(now, "now must not be null");
        if (bidderId == null || bidderId.isBlank()) {
            throw new IllegalArgumentException("bidderId must not be blank");
        }
        if (amount < 1_000L) {
            throw new IllegalArgumentException("amount must be at least 1000");
        }
    }
}
