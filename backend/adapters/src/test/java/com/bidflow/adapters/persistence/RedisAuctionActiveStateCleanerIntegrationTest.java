package com.bidflow.adapters.persistence;

import static org.assertj.core.api.Assertions.assertThat;

import com.bidflow.application.bid.AuctionRedisKeys;
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
class RedisAuctionActiveStateCleanerIntegrationTest {
    @Container
    static final GenericContainer<?> REDIS = new GenericContainer<>(DockerImageName.parse("redis:7.4.5-alpine"))
            .withExposedPorts(6379);

    private LettuceConnectionFactory connectionFactory;

    @AfterEach
    void closeConnectionFactory() {
        if (connectionFactory != null) connectionFactory.destroy();
    }

    @Test
    void removesStateAutomaticMaximumAndProcessedResultKeysTogether() {
        UUID auctionId = UUID.randomUUID();
        StringRedisTemplate redis = template();
        redis.opsForValue().set(AuctionRedisKeys.state(auctionId), "state");
        redis.opsForValue().set(AuctionRedisKeys.auto(auctionId), "auto");
        redis.opsForValue().set(AuctionRedisKeys.processed(auctionId), "processed");

        new RedisAuctionActiveStateCleaner(redis).clear(auctionId);

        assertThat(redis.hasKey(AuctionRedisKeys.state(auctionId))).isFalse();
        assertThat(redis.hasKey(AuctionRedisKeys.auto(auctionId))).isFalse();
        assertThat(redis.hasKey(AuctionRedisKeys.processed(auctionId))).isFalse();
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
