package com.bidflow.runtime;

import com.bidflow.application.realtime.RealtimeMessagePublisher;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.data.redis.listener.PatternTopic;
import org.springframework.data.redis.listener.RedisMessageListenerContainer;
import org.springframework.messaging.simp.config.MessageBrokerRegistry;
import org.springframework.scheduling.concurrent.ThreadPoolTaskScheduler;
import org.springframework.web.socket.config.annotation.EnableWebSocketMessageBroker;
import org.springframework.web.socket.config.annotation.StompEndpointRegistry;
import org.springframework.web.socket.config.annotation.WebSocketMessageBrokerConfigurer;

@Configuration
@EnableWebSocketMessageBroker
class RealtimeWebSocketConfiguration implements WebSocketMessageBrokerConfigurer {
    private final WebSocketAuthenticationInterceptor authenticationInterceptor;
    private final ThreadPoolTaskScheduler heartbeatScheduler;

    RealtimeWebSocketConfiguration(WebSocketAuthenticationInterceptor authenticationInterceptor, ThreadPoolTaskScheduler heartbeatScheduler) {
        this.authenticationInterceptor = authenticationInterceptor;
        this.heartbeatScheduler = heartbeatScheduler;
    }

    @Override
    public void registerStompEndpoints(StompEndpointRegistry registry) {
        registry.addEndpoint("/ws");
    }

    @Override
    public void configureMessageBroker(MessageBrokerRegistry registry) {
        registry.setApplicationDestinationPrefixes("/app");
        registry.setUserDestinationPrefix("/user");
        registry.enableSimpleBroker("/topic", "/queue")
                .setHeartbeatValue(new long[] {10_000L, 10_000L})
                .setTaskScheduler(heartbeatScheduler);
    }

    @Override
    public void configureClientInboundChannel(org.springframework.messaging.simp.config.ChannelRegistration registration) {
        registration.interceptors(authenticationInterceptor);
    }

    @Bean
    RedisRealtimeGateway redisRealtimeGateway(RedisConnectionFactory connectionFactory, ObjectMapper objectMapper, org.springframework.messaging.simp.SimpMessagingTemplate messaging) {
        return new RedisRealtimeGateway(connectionFactory, objectMapper, messaging);
    }

    @Bean
    RealtimeMessagePublisher realtimeMessagePublisher(RedisRealtimeGateway gateway) {
        return gateway;
    }

    @Bean
    @ConditionalOnProperty(prefix = "bidflow.realtime", name = "redis-listener-enabled", havingValue = "true", matchIfMissing = true)
    RedisMessageListenerContainer redisMessageListenerContainer(RedisConnectionFactory connectionFactory, RedisRealtimeGateway gateway) {
        return createRedisMessageListenerContainer(connectionFactory, gateway);
    }

    static RedisMessageListenerContainer createRedisMessageListenerContainer(RedisConnectionFactory connectionFactory, RedisRealtimeGateway gateway) {
        RedisMessageListenerContainer container = new RedisMessageListenerContainer();
        container.setConnectionFactory(connectionFactory);
        container.setMaxSubscriptionRegistrationWaitingTime(5_000L);
        container.addMessageListener(gateway, new PatternTopic("realtime.auction.*"));
        return container;
    }
}
