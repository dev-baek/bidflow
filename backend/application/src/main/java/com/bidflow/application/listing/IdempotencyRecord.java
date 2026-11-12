package com.bidflow.application.listing;

public record IdempotencyRecord(String payloadHash, ListingRegistrationResult result) {
}
