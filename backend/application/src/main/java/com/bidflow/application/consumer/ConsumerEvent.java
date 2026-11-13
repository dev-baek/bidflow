package com.bidflow.application.consumer;

import java.time.Instant;
import java.util.UUID;

/** Immutable metadata identifying one Kafka delivery handled by one consumer projection. */
public record ConsumerEvent(
        String consumerName,
        UUID eventId,
        String sourceTopic,
        int sourcePartition,
        long sourceOffset,
        Instant processedAt) {
}
