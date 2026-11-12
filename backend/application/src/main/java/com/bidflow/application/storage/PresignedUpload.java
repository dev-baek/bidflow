package com.bidflow.application.storage;

import java.net.URI;
import java.time.Instant;
import java.util.Map;
import java.util.Objects;

public record PresignedUpload(
        String objectKey,
        URI uploadUrl,
        Map<String, String> requiredHeaders,
        Instant expiresAt
) {
    public PresignedUpload {
        objectKey = Objects.requireNonNull(objectKey, "objectKey must not be null");
        uploadUrl = Objects.requireNonNull(uploadUrl, "uploadUrl must not be null");
        requiredHeaders = Map.copyOf(Objects.requireNonNull(requiredHeaders, "requiredHeaders must not be null"));
        expiresAt = Objects.requireNonNull(expiresAt, "expiresAt must not be null");
    }
}
