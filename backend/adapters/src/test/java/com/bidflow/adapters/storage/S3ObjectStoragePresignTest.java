package com.bidflow.adapters.storage;

import com.bidflow.application.storage.PresignUploadCommand;
import java.net.URI;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import software.amazon.awssdk.auth.credentials.AwsSessionCredentials;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;

import static org.assertj.core.api.Assertions.assertThat;

class S3ObjectStoragePresignTest {
    private static final UUID UPLOAD_ID = UUID.fromString("00000000-0000-0000-0000-000000000010");
    private static final Instant NOW = Instant.parse("2026-11-26T00:00:00Z");
    private static final PresignUploadCommand COMMAND = new PresignUploadCommand("seller-1", "image/png", 5, UPLOAD_ID, NOW);

    @Test
    void signsAwsPutWithSessionCredentialsAndJustTheBrowserWritableHeaders() {
        var credentials = StaticCredentialsProvider.create(AwsSessionCredentials.create("fake-key", "fake-secret", "fake-session"));
        try (var storage = S3ObjectStorage.forAws("bidflow-verification-123456789012-images", "ap-northeast-1", credentials)) {
            var upload = storage.presignUpload(COMMAND);
            assertThat(upload.uploadUrl().getScheme()).isEqualTo("https");
            assertThat(upload.uploadUrl().getHost()).isEqualTo("bidflow-verification-123456789012-images.s3.ap-northeast-1.amazonaws.com");
            assertThat(upload.uploadUrl().getPath()).isEqualTo("/products/seller-1/" + UPLOAD_ID);
            assertThat(upload.uploadUrl().getQuery()).contains("X-Amz-Expires=900", "X-Amz-Security-Token=",
                    "X-Amz-SignedHeaders=content-type;host;if-none-match");
            assertThat(upload.requiredHeaders()).isEqualTo(Map.of("Content-Type", "image/png", "If-None-Match", "*"));
            assertThat(upload.expiresAt()).isEqualTo(NOW.plusSeconds(900));
        }
    }

    @Test
    void keepsTheLocalPathStyleAndExistingHeaderContract() {
        try (var storage = new S3ObjectStorage(new S3ObjectStorageSettings(
                URI.create("http://localhost:8333"), "bidflow-images", "local-key", "local-secret", "us-east-1"))) {
            var upload = storage.presignUpload(COMMAND);
            assertThat(upload.uploadUrl().getPath()).isEqualTo("/bidflow-images/products/seller-1/" + UPLOAD_ID);
            assertThat(upload.requiredHeaders()).isEqualTo(Map.of("Content-Type", "image/png"));
        }
    }
}
