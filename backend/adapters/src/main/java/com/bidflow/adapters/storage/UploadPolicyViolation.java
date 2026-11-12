package com.bidflow.adapters.storage;

public final class UploadPolicyViolation extends IllegalArgumentException {
    public UploadPolicyViolation(String message) {
        super(message);
    }
}
