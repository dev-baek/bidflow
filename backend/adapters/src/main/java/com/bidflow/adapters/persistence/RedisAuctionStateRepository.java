package com.bidflow.adapters.persistence;

import com.bidflow.application.bid.AuctionRedisKeys;
import com.bidflow.application.bid.AuctionRedisState;
import com.bidflow.application.bid.AuctionStateRepository;
import com.bidflow.domain.listing.AuctionStatus;
import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.redis.core.StringRedisTemplate;

/** Redis adapter for the active-auction projection. It never replaces the PostgreSQL ledger. */
public final class RedisAuctionStateRepository implements AuctionStateRepository {
    private final StringRedisTemplate redis;

    public RedisAuctionStateRepository(StringRedisTemplate redis) {
        this.redis = Objects.requireNonNull(redis, "redis must not be null");
    }

    @Override
    public void save(AuctionRedisState state, Duration ttl) {
        Objects.requireNonNull(state, "state must not be null");
        requirePositive(ttl);
        String key = AuctionRedisKeys.state(state.auctionId());
        redis.opsForHash().putAll(key, toHash(state));
        redis.expire(key, ttl);
    }

    @Override
    public Optional<AuctionRedisState> findByAuctionId(UUID auctionId) {
        Map<Object, Object> values = redis.opsForHash().entries(AuctionRedisKeys.state(auctionId));
        if (values.isEmpty()) {
            return Optional.empty();
        }
        return Optional.of(new AuctionRedisState(
                auctionId,
                AuctionStatus.valueOf(required(values, "status")),
                Long.parseLong(required(values, "currentPrice")),
                required(values, "winnerId"),
                Long.parseLong(required(values, "winnerMax")),
                Instant.parse(required(values, "startsAt")),
                Instant.parse(required(values, "endsAt")),
                Long.parseLong(required(values, "version"))
        ));
    }

    @Override
    public void saveAutoMaximum(UUID auctionId, String bidderId, long maximum, Duration ttl) {
        if (bidderId == null || bidderId.isBlank()) {
            throw new IllegalArgumentException("bidderId must not be blank");
        }
        if (maximum < 0) {
            throw new IllegalArgumentException("maximum must not be negative");
        }
        requirePositive(ttl);
        String key = AuctionRedisKeys.auto(auctionId);
        redis.opsForZSet().add(key, bidderId, maximum);
        redis.expire(key, ttl);
    }

    private static Map<String, String> toHash(AuctionRedisState state) {
        Map<String, String> values = new LinkedHashMap<>();
        values.put("status", state.status().name());
        values.put("currentPrice", Long.toString(state.currentPrice()));
        values.put("winnerId", state.winnerId());
        values.put("winnerMax", Long.toString(state.winnerMaximum()));
        values.put("startsAt", state.startsAt().toString());
        values.put("endsAt", state.endsAt().toString());
        values.put("version", Long.toString(state.version()));
        return values;
    }

    private static String required(Map<Object, Object> values, String field) {
        Object value = values.get(field);
        if (value == null) {
            throw new IllegalStateException("Redis auction state is missing " + field);
        }
        return value.toString();
    }

    private static void requirePositive(Duration ttl) {
        if (ttl == null || ttl.isZero() || ttl.isNegative()) {
            throw new IllegalArgumentException("ttl must be positive");
        }
    }
}
