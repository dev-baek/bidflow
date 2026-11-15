package com.bidflow.runtime;

import java.util.List;
import java.util.Objects;
import org.springframework.security.oauth2.core.OAuth2Error;
import org.springframework.security.oauth2.core.OAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2TokenValidatorResult;
import org.springframework.security.oauth2.jwt.Jwt;

final class CognitoAccessTokenValidator implements OAuth2TokenValidator<Jwt> {
    private final String expectedClientId;

    CognitoAccessTokenValidator(String expectedClientId) {
        this.expectedClientId = Objects.requireNonNull(expectedClientId, "expectedClientId must not be null");
    }

    @Override
    public OAuth2TokenValidatorResult validate(Jwt token) {
        OAuth2Error tokenUseError = "access".equals(token.getClaimAsString("token_use")) ? null
                : new OAuth2Error("invalid_token_use", "Cognito access token is required", null);
        OAuth2Error clientError = expectedClientId.equals(token.getClaimAsString("client_id")) ? null
                : new OAuth2Error("invalid_client_id", "Cognito client does not match", null);
        OAuth2Error subjectError = token.getSubject() != null && !token.getSubject().isBlank() ? null
                : new OAuth2Error("invalid_subject", "Cognito subject is required", null);
        List<OAuth2Error> errors = java.util.stream.Stream.of(tokenUseError, clientError, subjectError)
                .filter(Objects::nonNull)
                .toList();
        return errors.isEmpty() ? OAuth2TokenValidatorResult.success() : OAuth2TokenValidatorResult.failure(errors);
    }
}
