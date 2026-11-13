package com.bidflow.application.bid;

import java.util.UUID;

/** Durable automatic-bid configuration needed to rebuild the Redis sorted set. */
public record AutoBidMaximum(UUID auctionId, String bidderId, long maximum) {
    public AutoBidMaximum {
        if (auctionId == null || bidderId == null || bidderId.isBlank() || maximum < 1_000L) {
            throw new IllegalArgumentException("auctionId, bidderId and maximum are required");
        }
    }
}
