package com.bidflow.adapters.persistence;

import static org.assertj.core.api.Assertions.assertThat;

import com.bidflow.application.bid.AuctionRedisKeys;
import com.bidflow.application.bid.AuctionRedisState;
import com.bidflow.application.bid.DirectBidCommand;
import com.bidflow.application.bid.DirectBidResultCode;
import com.bidflow.domain.listing.AuctionStatus;
import java.time.Duration;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.connection.lettuce.LettuceConnectionFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.utility.DockerImageName;

@Testcontainers(disabledWithoutDocker = true)
class RedisDirectBidProcessorIntegrationTest {
    private static final Instant NOW = Instant.parse("2030-01-01T12:00:00Z");

    @Container
    static final GenericContainer<?> REDIS = new GenericContainer<>(DockerImageName.parse("redis:7.4.5-alpine"))
            .withExposedPorts(6379);

    private LettuceConnectionFactory connectionFactory;

    @AfterEach
    void closeConnectionFactory() {
        if (connectionFactory != null) {
            connectionFactory.destroy();
        }
    }

    @Test
    void acceptsMinimumDirectBidAndUpdatesTheStateAtomically() {
        UUID auctionId = UUID.randomUUID();
        RedisAuctionStateRepository states = states();
        states.save(activeState(auctionId, 12_000L, "bidder-1", NOW.plus(Duration.ofMinutes(10))), Duration.ofHours(25));

        var result = processor().execute(new DirectBidCommand(UUID.randomUUID(), auctionId, "bidder-2", 13_000L, NOW));

        assertThat(result.code()).isEqualTo(DirectBidResultCode.ACCEPTED);
        assertThat(result.currentPrice()).isEqualTo(13_000L);
        assertThat(result.winnerId()).isEqualTo("bidder-2");
        assertThat(states.findByAuctionId(auctionId)).get().extracting(AuctionRedisState::currentPrice, AuctionRedisState::winnerId, AuctionRedisState::version)
                .containsExactly(13_000L, "bidder-2", 4L);
        assertThat(template().getExpire(AuctionRedisKeys.processed(auctionId))).isPositive();
    }

    @Test
    void returnsTheFirstResultWithoutRaisingThePriceAgainForTheSameRequest() {
        UUID auctionId = UUID.randomUUID();
        UUID requestId = UUID.randomUUID();
        RedisAuctionStateRepository states = states();
        states.save(activeState(auctionId, 12_000L, "bidder-1", NOW.plus(Duration.ofMinutes(10))), Duration.ofHours(25));

        var first = processor().execute(new DirectBidCommand(requestId, auctionId, "bidder-2", 13_000L, NOW));
        var replay = processor().execute(new DirectBidCommand(requestId, auctionId, "bidder-2", 99_000L, NOW.plusSeconds(1)));

        assertThat(replay).isEqualTo(first);
        assertThat(states.findByAuctionId(auctionId)).get().extracting(AuctionRedisState::currentPrice, AuctionRedisState::version)
                .containsExactly(13_000L, 4L);
    }

    @Test
    void extendsOnlyAnAcceptedBidWithLessThanFiveMinutesRemaining() {
        UUID auctionId = UUID.randomUUID();
        RedisAuctionStateRepository states = states();
        states.save(activeState(auctionId, 12_000L, "bidder-1", NOW.plus(Duration.ofMinutes(4))), Duration.ofHours(25));

        var result = processor().execute(new DirectBidCommand(UUID.randomUUID(), auctionId, "bidder-2", 13_000L, NOW));

        assertThat(result.code()).isEqualTo(DirectBidResultCode.ACCEPTED);
        assertThat(result.endsAt()).isEqualTo(NOW.plus(Duration.ofMinutes(9)));
    }

    @Test
    void doesNotExtendWhenExactlyFiveMinutesRemain() {
        UUID auctionId = UUID.randomUUID();
        RedisAuctionStateRepository states = states();
        Instant endsAt = NOW.plus(Duration.ofMinutes(5));
        states.save(activeState(auctionId, 12_000L, "bidder-1", endsAt), Duration.ofHours(25));

        var result = processor().execute(new DirectBidCommand(UUID.randomUUID(), auctionId, "bidder-2", 13_000L, NOW));

        assertThat(result.code()).isEqualTo(DirectBidResultCode.ACCEPTED);
        assertThat(result.endsAt()).isEqualTo(endsAt);
    }

    @Test
    void permitsAnotherFiveMinuteExtensionWhenTheUpdatedEndTimeAgainHasLessThanFiveMinutesRemaining() {
        UUID auctionId = UUID.randomUUID();
        RedisAuctionStateRepository states = states();
        Instant originalEndsAt = NOW.plus(Duration.ofMinutes(4));
        states.save(activeState(auctionId, 12_000L, "bidder-1", originalEndsAt), Duration.ofHours(25));

        processor().execute(new DirectBidCommand(UUID.randomUUID(), auctionId, "bidder-2", 13_000L, NOW));
        var second = processor().execute(new DirectBidCommand(UUID.randomUUID(), auctionId, "bidder-3", 14_000L, NOW.plus(Duration.ofMinutes(5)).plusSeconds(1)));

        assertThat(second.code()).isEqualTo(DirectBidResultCode.ACCEPTED);
        assertThat(second.endsAt()).isEqualTo(originalEndsAt.plus(Duration.ofMinutes(10)));
    }

    @Test
    void rejectsLowSelfAndEndedBidsWithoutChangingTheCurrentPrice() {
        assertRejected(12_000L, "bidder-2", NOW.plus(Duration.ofMinutes(10)), "bidder-1", 12_000L, DirectBidResultCode.BID_TOO_LOW);
        assertRejected(12_000L, "bidder-1", NOW.plus(Duration.ofMinutes(10)), "bidder-1", 13_000L, DirectBidResultCode.SELF_BID);
        assertRejected(12_000L, "bidder-2", NOW, "bidder-1", 13_000L, DirectBidResultCode.AUCTION_ENDED);
    }

    private void assertRejected(long currentPrice, String bidderId, Instant endsAt, String winnerId, long amount, DirectBidResultCode expected) {
        UUID auctionId = UUID.randomUUID();
        RedisAuctionStateRepository states = states();
        states.save(activeState(auctionId, currentPrice, winnerId, endsAt), Duration.ofHours(25));

        var result = processor().execute(new DirectBidCommand(UUID.randomUUID(), auctionId, bidderId, amount, NOW));

        assertThat(result.code()).isEqualTo(expected);
        assertThat(states.findByAuctionId(auctionId)).get().extracting(AuctionRedisState::currentPrice, AuctionRedisState::winnerId)
                .containsExactly(currentPrice, winnerId);
    }

    private AuctionRedisState activeState(UUID auctionId, long currentPrice, String winnerId, Instant endsAt) {
        return new AuctionRedisState(auctionId, AuctionStatus.ACTIVE, currentPrice, winnerId, currentPrice, NOW.minus(Duration.ofMinutes(10)), endsAt, 3L);
    }

    private RedisDirectBidProcessor processor() {
        return new RedisDirectBidProcessor(template());
    }

    private RedisAuctionStateRepository states() {
        return new RedisAuctionStateRepository(template());
    }

    private StringRedisTemplate template() {
        if (connectionFactory == null) {
            connectionFactory = new LettuceConnectionFactory(REDIS.getHost(), REDIS.getMappedPort(6379));
            connectionFactory.afterPropertiesSet();
        }
        StringRedisTemplate template = new StringRedisTemplate(connectionFactory);
        template.afterPropertiesSet();
        return template;
    }
}
