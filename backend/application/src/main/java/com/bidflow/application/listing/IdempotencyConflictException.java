package com.bidflow.application.listing;

public final class IdempotencyConflictException extends RuntimeException {
    public IdempotencyConflictException() {
        super("same idempotency key has a different payload");
    }
}
