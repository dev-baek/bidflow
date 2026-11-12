package com.bidflow.runtime;

import java.security.Principal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;

/** Validates Cognito access tokens and exposes the immutable Cognito subject as WebSocket Principal. */
final class CognitoAccessTokenVerifier implements WebSocketAccessTokenVerifier {
    private final JwtDecoder decoder;

    CognitoAccessTokenVerifier(JwtDecoder decoder) {
        this.decoder = decoder;
    }

    @Override
    public Principal verify(String accessToken) {
        Jwt jwt = decoder.decode(accessToken);
        if (!"access".equals(jwt.getClaimAsString("token_use")) || jwt.getSubject() == null || jwt.getSubject().isBlank()) {
            throw new IllegalArgumentException("Cognito access token is required");
        }
        return jwt::getSubject;
    }
}
