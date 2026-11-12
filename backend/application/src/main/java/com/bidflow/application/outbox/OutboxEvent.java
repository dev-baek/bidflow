package com.bidflow.application.outbox;

import java.time.Instant;
import java.util.UUID;

public record OutboxEvent(UUID eventId, String topic, String key, String correlationId, String eventType, String payload, Instant occurredAt) {
}
