package com.bidflow.runtime;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Profile;
import org.springframework.security.oauth2.jwt.JwtDecoder;

@Configuration
@ConditionalOnProperty(prefix = "bidflow.cognito", name = "issuer-uri")
class CognitoWebSocketSecurityConfiguration {
    @Bean
    WebSocketAccessTokenVerifier webSocketAccessTokenVerifier(JwtDecoder decoder) {
        return new CognitoAccessTokenVerifier(decoder);
    }
}

@Configuration
@Profile("local")
class LocalWebSocketSecurityConfiguration {
    @Bean
    WebSocketAccessTokenVerifier localWebSocketAccessTokenVerifier() {
        return actorId -> {
            if (actorId == null || actorId.isBlank()) throw new IllegalArgumentException("local WebSocket actor is required");
            return () -> actorId;
        };
    }
}
