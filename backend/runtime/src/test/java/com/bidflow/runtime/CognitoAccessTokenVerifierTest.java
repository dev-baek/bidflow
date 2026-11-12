package com.bidflow.runtime;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Instant;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.security.oauth2.jwt.Jwt;

class CognitoAccessTokenVerifierTest {
    @Test
    void exposesTheCognitoSubjectOnlyForAnAccessToken() {
        CognitoAccessTokenVerifier verifier = new CognitoAccessTokenVerifier(token -> jwt("access", "cognito-subject"));

        assertThat(verifier.verify("token").getName()).isEqualTo("cognito-subject");
    }

    @Test
    void rejectsAnIdTokenAtTheWebSocketBoundary() {
        CognitoAccessTokenVerifier verifier = new CognitoAccessTokenVerifier(token -> jwt("id", "cognito-subject"));

        assertThatThrownBy(() -> verifier.verify("token")).isInstanceOf(IllegalArgumentException.class);
    }

    private static Jwt jwt(String tokenUse, String subject) {
        return new Jwt("token", Instant.parse("2030-01-01T00:00:00Z"), Instant.parse("2030-01-01T01:00:00Z"),
                Map.of("alg", "RS256"), Map.of("sub", subject, "token_use", tokenUse));
    }
}
