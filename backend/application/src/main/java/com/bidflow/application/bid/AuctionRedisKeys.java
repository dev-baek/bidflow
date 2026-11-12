package com.bidflow.application.bid;

import java.util.UUID;

/**
 * Redis key names used by the active-auction projection.
 *
 * <p>The key format is kept independent of the Redis client so Lua scripts and adapters share
 * exactly the same names.</p>
 */
public final class AuctionRedisKeys {
    private AuctionRedisKeys() {
    }

    public static String state(UUID auctionId) {
        return prefix(auctionId) + "state";
    }

    public static String auto(UUID auctionId) {
        return prefix(auctionId) + "auto";
    }

    public static String processed(UUID auctionId) {
        return prefix(auctionId) + "processed";
    }

    private static String prefix(UUID auctionId) {
        if (auctionId == null) {
            throw new IllegalArgumentException("auctionId must not be null");
        }
        return "auction:" + auctionId + ":";
    }
}
