package com.bidflow.adapters.persistence;

import com.bidflow.application.bid.AuctionRedisKeys;
import com.bidflow.application.bid.DirectBidCommand;
import com.bidflow.application.bid.DirectBidProcessor;
import com.bidflow.application.bid.DirectBidResult;
import com.bidflow.application.bid.DirectBidResultCode;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.List;
import java.util.Objects;
import org.springframework.core.io.ClassPathResource;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;

/** Runs the direct-bid Lua program so validation and all Redis writes share one atomic boundary. */
public final class RedisDirectBidProcessor implements DirectBidProcessor {
    private static final DefaultRedisScript<List> DIRECT_BID = loadScript();
    private final StringRedisTemplate redis;

    public RedisDirectBidProcessor(StringRedisTemplate redis) {
        this.redis = Objects.requireNonNull(redis, "redis must not be null");
    }

    @Override
    public DirectBidResult execute(DirectBidCommand command) {
        Objects.requireNonNull(command, "command must not be null");
        List<?> values = redis.execute(
                DIRECT_BID,
                List.of(
                        AuctionRedisKeys.state(command.auctionId()),
                        AuctionRedisKeys.auto(command.auctionId()),
                        AuctionRedisKeys.processed(command.auctionId())
                ),
                command.bidRequestId().toString(),
                command.bidderId(),
                Long.toString(command.amount()),
                Long.toString(command.now().toEpochMilli())
        );
        if (values == null || values.size() != 6) {
            throw new IllegalStateException("direct bid script returned an invalid result");
        }
        return new DirectBidResult(
                DirectBidResultCode.valueOf(value(values, 0)),
                Long.parseLong(value(values, 1)),
                value(values, 2),
                Long.parseLong(value(values, 3)),
                Instant.ofEpochMilli(Long.parseLong(value(values, 4))),
                Long.parseLong(value(values, 5))
        );
    }

    private static String value(List<?> values, int index) {
        return String.valueOf(values.get(index));
    }

    private static DefaultRedisScript<List> loadScript() {
        try {
            DefaultRedisScript<List> script = new DefaultRedisScript<>();
            script.setScriptText(new ClassPathResource("lua/direct-bid.lua").getContentAsString(StandardCharsets.UTF_8));
            script.setResultType(List.class);
            return script;
        } catch (IOException exception) {
            throw new UncheckedIOException("Unable to load direct bid Lua script", exception);
        }
    }
}
