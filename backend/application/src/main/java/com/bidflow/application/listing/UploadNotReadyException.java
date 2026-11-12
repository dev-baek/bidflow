package com.bidflow.application.listing;

public final class UploadNotReadyException extends RuntimeException {
    public UploadNotReadyException() {
        super("upload is not ready or not owned by actor");
    }
}
