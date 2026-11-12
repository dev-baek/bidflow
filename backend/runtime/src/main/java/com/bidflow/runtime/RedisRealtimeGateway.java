package com.bidflow.runtime;

import com.bidflow.application.realtime.RealtimeMessage;
import com.bidflow.application.realtime.RealtimeMessagePublisher;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.util.Objects;
import org.springframework.data.redis.connection.Message;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.data.redis.connection.MessageListener;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.messaging.simp.SimpMessagingTemplate;

/** Redis Pub/Sub bridge: every API instance receives a message and fans it out to local STOMP sessions. */
final class RedisRealtimeGateway implements RealtimeMessagePublisher, MessageListener {
    private static final String CHANNEL_PREFIX = "realtime.auction.";
    private final StringRedisTemplate redis;
    private final ObjectMapper objectMapper;
    private final SimpMessagingTemplate messaging;

    RedisRealtimeGateway(RedisConnectionFactory connectionFactory, ObjectMapper objectMapper, SimpMessagingTemplate messaging) {
        redis = new StringRedisTemplate(Objects.requireNonNull(connectionFactory, "connectionFactory must not be null"));
        redis.afterPropertiesSet();
        this.objectMapper = Objects.requireNonNull(objectMapper, "objectMapper must not be null");
        this.messaging = Objects.requireNonNull(messaging, "messaging must not be null");
    }

    @Override
    public void publish(RealtimeMessage message) {
        redis.convertAndSend(channel(message.auctionId().toString()), serialize(message));
    }

    @Override
    public void onMessage(Message message, byte[] pattern) {
        try {
            RealtimeMessage delivery = objectMapper.readValue(message.getBody(), RealtimeMessage.class);
            if (delivery.hasRecipient()) {
                messaging.convertAndSendToUser(delivery.recipientId(), "/queue/bid-results", delivery.payload());
            } else {
                messaging.convertAndSend("/topic/auctions/" + delivery.auctionId(), delivery.payload());
            }
        } catch (Exception exception) {
            throw new IllegalArgumentException("invalid realtime Redis message", exception);
        }
    }

    static String channel(String auctionId) {
        return CHANNEL_PREFIX + auctionId;
    }

    private String serialize(RealtimeMessage message) {
        try {
            return objectMapper.writeValueAsString(message);
        } catch (Exception exception) {
            throw new IllegalStateException("realtime message serialization failed", exception);
        }
    }
}
