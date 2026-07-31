package com.bidflow.event;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class EventEnvelopeTest {

    @Test
    void keepsProvidedIdentityTimeAndPayloadWithoutGeneratingHiddenValues() {
        UUID eventId = UUID.fromString("b9347c5f-b02f-4a67-89c9-2d2272ed1a32");
        Instant occurredAt = Instant.parse("2026-07-29T00:00:00Z");
        Map<String, String> payload = Map.of("auctionId", "auction-1");

        EventEnvelope<Map<String, String>> envelope = new EventEnvelope<>(
                eventId,
                "AuctionCreated",
                1,
                occurredAt,
                "request-1",
                payload);

        assertThat(envelope.eventId()).isEqualTo(eventId);
        assertThat(envelope.eventType()).isEqualTo("AuctionCreated");
        assertThat(envelope.schemaVersion()).isEqualTo(1);
        assertThat(envelope.occurredAt()).isEqualTo(occurredAt);
        assertThat(envelope.correlationId()).isEqualTo("request-1");
        assertThat(envelope.payload()).isEqualTo(payload);
    }
}
