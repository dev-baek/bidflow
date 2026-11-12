package com.bidflow.runtime;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtDecoders;

@Configuration
@ConditionalOnProperty(prefix = "bidflow.cognito", name = "issuer-uri")
class CognitoWebSocketSecurityConfiguration {
    @Bean
    JwtDecoder cognitoJwtDecoder(@Value("${bidflow.cognito.issuer-uri}") String issuerUri) {
        return JwtDecoders.fromIssuerLocation(issuerUri);
    }

    @Bean
    WebSocketAccessTokenVerifier webSocketAccessTokenVerifier(JwtDecoder decoder) {
        return new CognitoAccessTokenVerifier(decoder);
    }
}
