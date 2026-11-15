package com.bidflow.runtime;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.security.oauth2.jwt.Jwt;

class CognitoAccessTokenValidatorTest {
    private final CognitoAccessTokenValidator validator = new CognitoAccessTokenValidator("bidflow-web-client");

    @Test
    void acceptsAnAccessTokenForTheConfiguredClientAndSubject() {
        assertThat(validator.validate(jwt("access", "bidflow-web-client", "cognito-subject")).hasErrors()).isFalse();
    }

    @Test
    void rejectsAnIdTokenEvenWhenItHasTheExpectedClientAndSubject() {
        assertThat(validator.validate(jwt("id", "bidflow-web-client", "cognito-subject")).getErrors())
                .extracting(error -> error.getErrorCode())
                .contains("invalid_token_use");
    }

    @Test
    void rejectsAnAccessTokenForAnotherClientOrWithoutASubject() {
        assertThat(validator.validate(jwt("access", "other-client", "cognito-subject")).getErrors())
                .extracting(error -> error.getErrorCode())
                .contains("invalid_client_id");
        assertThat(validator.validate(jwt("access", "bidflow-web-client", " ")).getErrors())
                .extracting(error -> error.getErrorCode())
                .contains("invalid_subject");
    }

    private static Jwt jwt(String tokenUse, String clientId, String subject) {
        return new Jwt("token", Instant.parse("2030-01-01T00:00:00Z"), Instant.parse("2030-01-01T01:00:00Z"),
                Map.of("alg", "RS256"), Map.of("token_use", tokenUse, "client_id", clientId, "sub", subject));
    }
}
