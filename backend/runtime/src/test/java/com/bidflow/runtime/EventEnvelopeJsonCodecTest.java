package com.bidflow.runtime;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.bidflow.event.EventEnvelope;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class EventEnvelopeJsonCodecTest {

    private final EventEnvelopeJsonCodec codec = new EventEnvelopeJsonCodec(new ObjectMapper().findAndRegisterModules());

    @Test
    void roundTripsTheCommonEnvelopeWithoutChangingItsContractFields() {
        EventEnvelope<Map<String, Object>> event = new EventEnvelope<>(
                UUID.fromString("b9347c5f-b02f-4a67-89c9-2d2272ed1a32"),
                "ListingPublished",
                1,
                Instant.parse("2026-11-12T00:00:00Z"),
                "request-1",
                Map.of("productId", "product-1", "amount", 12000));

        assertThat(codec.deserialize(codec.serialize(event))).isEqualTo(event);
    }

    @Test
    void rejectsAValueThatDoesNotContainAnEnvelope() {
        assertThatThrownBy(() -> codec.deserialize("{}"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("invalid Kafka event envelope");
    }
}
