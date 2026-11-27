package com.bidflow.application.storage;

import java.net.URI;
import java.util.Optional;

public interface ObjectStorage {
    PresignedUpload presignUpload(PresignUploadCommand command);

    Optional<StoredObject> headObject(String objectKey);

    URI presignRead(String objectKey);
}
