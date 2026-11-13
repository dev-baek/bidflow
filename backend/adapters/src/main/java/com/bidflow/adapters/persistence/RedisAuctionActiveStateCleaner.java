package com.bidflow.adapters.persistence;

import com.bidflow.application.auction.AuctionActiveStateCleaner;
import com.bidflow.application.bid.AuctionRedisKeys;
import java.util.List;
import java.util.UUID;
import org.springframework.data.redis.core.StringRedisTemplate;

/** Redis deletion is intentionally idempotent so an at-least-once AuctionEnded consumer is safe. */
public final class RedisAuctionActiveStateCleaner implements AuctionActiveStateCleaner {
    private final StringRedisTemplate redis;

    public RedisAuctionActiveStateCleaner(StringRedisTemplate redis) {
        this.redis = redis;
    }

    @Override
    public void clear(UUID auctionId) {
        redis.delete(List.of(AuctionRedisKeys.state(auctionId), AuctionRedisKeys.auto(auctionId), AuctionRedisKeys.processed(auctionId)));
    }
}
