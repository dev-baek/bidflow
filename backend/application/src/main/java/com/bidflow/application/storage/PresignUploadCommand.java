package com.bidflow.application.storage;

import java.time.Instant;
import java.util.Objects;
import java.util.UUID;

public record PresignUploadCommand(
        String actorId,
        String contentType,
        long contentLength,
        UUID uploadId,
        Instant now
) {
    public PresignUploadCommand {
        actorId = Objects.requireNonNull(actorId, "actorId must not be null");
        contentType = Objects.requireNonNull(contentType, "contentType must not be null");
        uploadId = Objects.requireNonNull(uploadId, "uploadId must not be null");
        now = Objects.requireNonNull(now, "now must not be null");
    }
}
