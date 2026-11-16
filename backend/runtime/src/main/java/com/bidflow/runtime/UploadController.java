package com.bidflow.runtime;

import com.bidflow.application.storage.ObjectStorage;
import com.bidflow.application.storage.PresignUploadCommand;
import com.bidflow.application.storage.PresignedUpload;
import java.security.Principal;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/uploads")
class UploadController {
    private final ObjectStorage storage;

    UploadController(ObjectStorage storage) {
        this.storage = storage;
    }

    @PostMapping("/presign")
    @ResponseStatus(HttpStatus.CREATED)
    Response presign(Principal actor, @RequestBody Request request) {
        UUID uploadId = UUID.randomUUID();
        PresignedUpload upload = storage.presignUpload(new PresignUploadCommand(actor.getName(), request.contentType(),
                request.contentLength(), uploadId, Instant.now()));
        return new Response(uploadId, upload.objectKey(), upload.uploadUrl().toString(), upload.requiredHeaders(), upload.expiresAt());
    }

    record Request(String contentType, long contentLength) { }
    record Response(UUID uploadId, String objectKey, String uploadUrl, Map<String, String> requiredHeaders, Instant expiresAt) { }
}
