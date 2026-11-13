package com.bidflow.adapters.persistence;

import static org.assertj.core.api.Assertions.assertThat;

import com.bidflow.application.bid.AuctionRedisKeys;
import com.bidflow.application.bid.AuctionRedisState;
import com.bidflow.application.bid.AutoBidCommand;
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
class RedisAutoBidProcessorIntegrationTest {
    private static final Instant NOW = Instant.parse("2030-01-01T12:00:00Z");

    @Container
    static final GenericContainer<?> REDIS = new GenericContainer<>(DockerImageName.parse("redis:7.4.5-alpine"))
            .withExposedPorts(6379);

    private LettuceConnectionFactory connectionFactory;

    @AfterEach
    void closeConnectionFactory() {
        if (connectionFactory != null) connectionFactory.destroy();
    }

    @Test
    void firstAutomaticMaximumStoresThePrivateMaximumButPublishesOnlyTheNextPrice() {
        UUID auctionId = seedState();

        var result = processor().execute(new AutoBidCommand(UUID.randomUUID(), auctionId, "bidder-2", 20_000L, NOW));

        assertThat(result.code()).isEqualTo(DirectBidResultCode.ACCEPTED);
        assertThat(result.currentPrice()).isEqualTo(13_000L);
        assertThat(result.winnerId()).isEqualTo("bidder-2");
        assertThat(result.winnerMaximum()).isEqualTo(20_000L);
        assertThat(template().opsForZSet().score(AuctionRedisKeys.auto(auctionId), "bidder-2")).isEqualTo(20_000D);
    }

    @Test
    void lowerMaximumKeepsCurrentWinnerAndRaisesThePublicPriceByOneIncrement() {
        UUID auctionId = seedState();
        processor().execute(new AutoBidCommand(UUID.randomUUID(), auctionId, "bidder-2", 20_000L, NOW));

        var result = processor().execute(new AutoBidCommand(UUID.randomUUID(), auctionId, "bidder-3", 17_000L, NOW.plusSeconds(1)));

        assertThat(result.code()).isEqualTo(DirectBidResultCode.ACCEPTED);
        assertThat(result.winnerId()).isEqualTo("bidder-2");
        assertThat(result.currentPrice()).isEqualTo(18_000L);
        assertThat(result.winnerMaximum()).isEqualTo(20_000L);
    }

    @Test
    void higherMaximumWinsAndEqualMaximumKeepsTheExistingWinner() {
        UUID auctionId = seedState();
        processor().execute(new AutoBidCommand(UUID.randomUUID(), auctionId, "bidder-2", 20_000L, NOW));

        var equal = processor().execute(new AutoBidCommand(UUID.randomUUID(), auctionId, "bidder-3", 20_000L, NOW.plusSeconds(1)));
        var higher = processor().execute(new AutoBidCommand(UUID.randomUUID(), auctionId, "bidder-4", 25_000L, NOW.plusSeconds(2)));

        assertThat(equal.winnerId()).isEqualTo("bidder-2");
        assertThat(equal.currentPrice()).isEqualTo(20_000L);
        assertThat(higher.winnerId()).isEqualTo("bidder-4");
        assertThat(higher.currentPrice()).isEqualTo(21_000L);
        assertThat(higher.winnerMaximum()).isEqualTo(25_000L);
    }

    @Test
    void winnerCanRaiseTheirMaximumWithoutChangingThePublicPriceAndReplayIsStable() {
        UUID auctionId = seedState();
        UUID requestId = UUID.randomUUID();
        processor().execute(new AutoBidCommand(UUID.randomUUID(), auctionId, "bidder-2", 20_000L, NOW));
        var raised = processor().execute(new AutoBidCommand(requestId, auctionId, "bidder-2", 25_000L, NOW.plusSeconds(1)));
        var replay = processor().execute(new AutoBidCommand(requestId, auctionId, "bidder-2", 99_000L, NOW.plusSeconds(2)));

        assertThat(raised.code()).isEqualTo(DirectBidResultCode.ACCEPTED);
        assertThat(raised.currentPrice()).isEqualTo(13_000L);
        assertThat(raised.winnerMaximum()).isEqualTo(25_000L);
        assertThat(replay).isEqualTo(raised);
    }

    @Test
    void rejectsMaximumBelowTheCurrentMinimumWithoutStoringIt() {
        UUID auctionId = seedState();

        var result = processor().execute(new AutoBidCommand(UUID.randomUUID(), auctionId, "bidder-2", 12_000L, NOW));

        assertThat(result.code()).isEqualTo(DirectBidResultCode.BID_TOO_LOW);
        assertThat(template().opsForZSet().score(AuctionRedisKeys.auto(auctionId), "bidder-2")).isNull();
        assertThat(states().findByAuctionId(auctionId)).get().extracting(AuctionRedisState::currentPrice, AuctionRedisState::winnerId)
                .containsExactly(12_000L, "");
    }

    @Test
    void extendsTheExistingEndTimeForAnAcceptedAutomaticBidNearClosing() {
        UUID auctionId = UUID.randomUUID();
        Instant endsAt = NOW.plus(Duration.ofMinutes(4));
        states().save(new AuctionRedisState(auctionId, AuctionStatus.ACTIVE, 12_000L, "", 12_000L,
                NOW.minus(Duration.ofMinutes(10)), endsAt, 1L), Duration.ofHours(25));

        var result = processor().execute(new AutoBidCommand(UUID.randomUUID(), auctionId, "bidder-2", 20_000L, NOW));

        assertThat(result.code()).isEqualTo(DirectBidResultCode.ACCEPTED);
        assertThat(result.endsAt()).isEqualTo(endsAt.plus(Duration.ofMinutes(5)));
    }

    private UUID seedState() {
        UUID auctionId = UUID.randomUUID();
        states().save(new AuctionRedisState(
                auctionId, AuctionStatus.ACTIVE, 12_000L, "", 12_000L,
                NOW.minus(Duration.ofMinutes(10)), NOW.plus(Duration.ofMinutes(10)), 1L), Duration.ofHours(25));
        return auctionId;
    }

    private RedisAutoBidProcessor processor() {
        return new RedisAutoBidProcessor(template());
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
