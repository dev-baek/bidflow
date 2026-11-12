package com.bidflow.adapters.persistence;

import static org.assertj.core.api.Assertions.assertThat;

import com.bidflow.application.bid.AuctionRedisKeys;
import com.bidflow.application.bid.AuctionRedisState;
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
class RedisAuctionStateRepositoryIntegrationTest {
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
    void storesStateAndAutomaticMaximumInTheirDocumentedRedisStructures() {
        RedisAuctionStateRepository repository = repository();
        UUID auctionId = UUID.fromString("00000000-0000-0000-0000-000000000001");
        AuctionRedisState state = new AuctionRedisState(
                auctionId,
                AuctionStatus.ACTIVE,
                12_000L,
                "bidder-1",
                20_000L,
                Instant.parse("2026-11-12T00:00:00Z"),
                Instant.parse("2026-11-12T01:00:00Z"),
                3L
        );

        repository.save(state, Duration.ofHours(25));
        repository.saveAutoMaximum(auctionId, "bidder-2", 25_000L, Duration.ofHours(25));

        assertThat(repository.findByAuctionId(auctionId)).contains(state);
        assertThat(template().opsForZSet().score(AuctionRedisKeys.auto(auctionId), "bidder-2")).isEqualTo(25_000D);
        assertThat(template().getExpire(AuctionRedisKeys.state(auctionId))).isPositive();
        assertThat(template().getExpire(AuctionRedisKeys.auto(auctionId))).isPositive();
    }

    private RedisAuctionStateRepository repository() {
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
