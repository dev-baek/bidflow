package com.bidflow.runtime;

import static org.assertj.core.api.Assertions.assertThat;

import com.bidflow.application.realtime.RealtimeMessage;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.connection.lettuce.LettuceConnectionFactory;
import org.springframework.data.redis.listener.RedisMessageListenerContainer;
import org.springframework.messaging.Message;
import org.springframework.messaging.MessageChannel;
import org.springframework.messaging.simp.SimpMessageHeaderAccessor;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.utility.DockerImageName;

@Testcontainers(disabledWithoutDocker = true)
class RedisRealtimeGatewayIntegrationTest {
    @Container
    static final GenericContainer<?> REDIS = new GenericContainer<>(DockerImageName.parse("redis:7.4.5-alpine"))
            .withExposedPorts(6379);

    private LettuceConnectionFactory connectionFactory;
    private RedisMessageListenerContainer subscriber;

    @AfterEach
    void closeResources() throws Exception {
        if (subscriber != null) subscriber.destroy();
        if (connectionFactory != null) connectionFactory.destroy();
    }

    @Test
    void deliversMessagePublishedByOneApiInstanceToAnotherInstancesLocalStompTopic() throws Exception {
        connectionFactory = new LettuceConnectionFactory(REDIS.getHost(), REDIS.getMappedPort(6379));
        connectionFactory.afterPropertiesSet();
        CapturingChannel channel = new CapturingChannel();
        RedisRealtimeGateway publishingInstance = new RedisRealtimeGateway(connectionFactory, new ObjectMapper(), new SimpMessagingTemplate(new DiscardingChannel()));
        RedisRealtimeGateway subscribedInstance = new RedisRealtimeGateway(connectionFactory, new ObjectMapper(), new SimpMessagingTemplate(channel));
        subscriber = RealtimeWebSocketConfiguration.createRedisMessageListenerContainer(connectionFactory, subscribedInstance);
        subscriber.afterPropertiesSet();
        subscriber.start();
        RealtimeMessage message = new RealtimeMessage(UUID.randomUUID(), UUID.randomUUID(), null, "{\"type\":\"auction.updated\"}");

        publishingInstance.publish(message);

        assertThat(channel.await()).isTrue();
        assertThat(channel.destination()).isEqualTo("/topic/auctions/" + message.auctionId());
        assertThat(channel.payload()).isEqualTo(message.payload());
    }

    private static final class CapturingChannel implements MessageChannel {
        private final CountDownLatch delivered = new CountDownLatch(1);
        private Message<?> message;

        @Override public boolean send(Message<?> message) { this.message = message; delivered.countDown(); return true; }
        @Override public boolean send(Message<?> message, long timeout) { return send(message); }
        boolean await() throws InterruptedException { return delivered.await(5, TimeUnit.SECONDS); }
        String destination() { return SimpMessageHeaderAccessor.wrap(message).getDestination(); }
        Object payload() { return message.getPayload(); }
    }

    private static final class DiscardingChannel implements MessageChannel {
        @Override public boolean send(Message<?> message) { return true; }
        @Override public boolean send(Message<?> message, long timeout) { return true; }
    }
}
