package com.bidflow.adapters.storage;

import java.net.URI;
import java.util.Objects;

public record S3ObjectStorageSettings(
        URI endpoint,
        String bucket,
        String accessKey,
        String secretKey,
        String region
) {
    public S3ObjectStorageSettings {
        endpoint = Objects.requireNonNull(endpoint, "endpoint must not be null");
        bucket = requireText(bucket, "bucket");
        accessKey = requireText(accessKey, "accessKey");
        secretKey = requireText(secretKey, "secretKey");
        region = requireText(region, "region");
    }

    private static String requireText(String value, String name) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException(name + " must not be blank");
        }
        return value;
    }
}
