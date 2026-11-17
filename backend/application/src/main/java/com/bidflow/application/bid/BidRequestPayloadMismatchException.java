package com.bidflow.application.bid;

public final class BidRequestPayloadMismatchException extends RuntimeException {
    public BidRequestPayloadMismatchException() {
        super("same bid idempotency key has a different payload");
    }
}
