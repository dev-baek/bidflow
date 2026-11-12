package com.bidflow.application.storage;

import java.util.Objects;

public record StoredObject(String objectKey, String contentType, long contentLength) {
    public StoredObject {
        objectKey = Objects.requireNonNull(objectKey, "objectKey must not be null");
        contentType = Objects.requireNonNull(contentType, "contentType must not be null");
    }
}
