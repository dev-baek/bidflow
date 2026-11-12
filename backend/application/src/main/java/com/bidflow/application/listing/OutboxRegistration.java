package com.bidflow.application.listing;

import java.time.Instant;
import java.util.UUID;

public record OutboxRegistration(UUID eventId, UUID aggregateId, String eventType, String payload, Instant occurredAt) {
}
