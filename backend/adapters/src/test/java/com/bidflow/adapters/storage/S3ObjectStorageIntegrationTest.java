package com.bidflow.adapters.storage;

import com.bidflow.application.storage.ObjectStorage;
import com.bidflow.application.storage.PresignUploadCommand;
import com.bidflow.application.storage.StoredObject;
import org.junit.jupiter.api.Test;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.utility.DockerImageName;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Instant;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@Testcontainers(disabledWithoutDocker = true)
class S3ObjectStorageIntegrationTest {
    private static final String ACCESS_KEY = "bidflow-local-access";
    private static final String SECRET_KEY = "bidflow-local-secret";
    private static final String BUCKET = "bidflow-images";

    @Container
    static final GenericContainer<?> SEAWEED = new GenericContainer<>(DockerImageName.parse("chrislusf/seaweedfs:4.38"))
            .withEnv("AWS_ACCESS_KEY_ID", ACCESS_KEY)
            .withEnv("AWS_SECRET_ACCESS_KEY", SECRET_KEY)
            .withEnv("S3_BUCKET", BUCKET)
            .withExposedPorts(8333);

    @Test
    void uploadsWithPresignedPutUrlAndReadsObjectMetadata() throws Exception {
        ObjectStorage storage = storage();
        PresignUploadCommand command = new PresignUploadCommand(
                "seller-1",
                "image/jpeg",
                5L,
                UUID.fromString("00000000-0000-0000-0000-000000000010"),
                Instant.parse("2026-11-12T00:00:00Z")
        );

        var upload = storage.presignUpload(command);
        HttpRequest request = HttpRequest.newBuilder(upload.uploadUrl())
                .header("Content-Type", "image/jpeg")
                .PUT(HttpRequest.BodyPublishers.ofByteArray(new byte[]{1, 2, 3, 4, 5}))
                .build();
        HttpResponse<Void> response = HttpClient.newHttpClient().send(request, HttpResponse.BodyHandlers.discarding());

        StoredObject storedObject = storage.headObject(upload.objectKey()).orElseThrow();
        assertThat(response.statusCode()).isEqualTo(200);
        assertThat(upload.objectKey()).isEqualTo("products/seller-1/00000000-0000-0000-0000-000000000010");
        assertThat(upload.requiredHeaders()).containsEntry("Content-Type", "image/jpeg");
        assertThat(upload.expiresAt()).isEqualTo(Instant.parse("2026-11-12T00:15:00Z"));
        assertThat(storedObject.contentType()).isEqualTo("image/jpeg");
        assertThat(storedObject.contentLength()).isEqualTo(5L);
    }

    @Test
    void rejectsContentTypeAndSizeOutsideUploadPolicy() {
        ObjectStorage storage = storage();
        Instant now = Instant.parse("2026-11-12T00:00:00Z");

        assertThatThrownBy(() -> storage.presignUpload(new PresignUploadCommand(
                "seller-1", "image/gif", 5L, UUID.randomUUID(), now
        ))).isInstanceOf(UploadPolicyViolation.class);
        assertThatThrownBy(() -> storage.presignUpload(new PresignUploadCommand(
                "seller-1", "image/png", 10L * 1024L * 1024L + 1L, UUID.randomUUID(), now
        ))).isInstanceOf(UploadPolicyViolation.class);
    }

    private static ObjectStorage storage() {
        return new S3ObjectStorage(new S3ObjectStorageSettings(
                URI.create("http://" + SEAWEED.getHost() + ":" + SEAWEED.getMappedPort(8333)),
                BUCKET,
                ACCESS_KEY,
                SECRET_KEY,
                "us-east-1"
        ));
    }
}
