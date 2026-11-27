package com.bidflow.runtime;

import static org.assertj.core.api.Assertions.assertThat;

import com.bidflow.application.storage.ObjectStorage;
import com.bidflow.application.storage.PresignUploadCommand;
import com.bidflow.application.storage.PresignedUpload;
import com.bidflow.application.storage.StoredObject;
import java.net.URI;
import java.time.Instant;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.Test;

class UploadControllerTest {
    @Test
    void createsAnUploadIdOnTheServerAndDoesNotAcceptAnObjectKeyFromTheBrowser() {
        CapturingStorage storage = new CapturingStorage();
        UploadController controller = new UploadController(storage);

        UploadController.Response response = controller.presign(() -> "seller-1", new UploadController.Request("image/jpeg", 1024));

        assertThat(storage.command.actorId()).isEqualTo("seller-1");
        assertThat(storage.command.contentType()).isEqualTo("image/jpeg");
        assertThat(response.objectKey()).isEqualTo("products/seller-1/" + response.uploadId());
    }

    private static final class CapturingStorage implements ObjectStorage {
        private PresignUploadCommand command;
        @Override public PresignedUpload presignUpload(PresignUploadCommand value) {
            command = value;
            return new PresignedUpload("products/seller-1/" + value.uploadId(), URI.create("http://storage/upload"), Map.of("Content-Type", value.contentType()), value.now().plusSeconds(900));
        }
        @Override public Optional<StoredObject> headObject(String objectKey) { return Optional.empty(); }
        @Override public URI presignRead(String objectKey) { throw new UnsupportedOperationException(); }
    }
}
