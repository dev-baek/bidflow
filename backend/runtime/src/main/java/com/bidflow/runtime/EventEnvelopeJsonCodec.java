package com.bidflow.runtime;

import com.bidflow.event.EventEnvelope;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;

/** JSON boundary adapter for the Kafka event envelope; the event-contract module remains dependency-free. */
final class EventEnvelopeJsonCodec {
    private static final TypeReference<Map<String, Object>> PAYLOAD_TYPE = new TypeReference<>() {};

    private final ObjectMapper objectMapper;

    EventEnvelopeJsonCodec(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper.copy().disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);
    }

    String serialize(EventEnvelope<?> event) {
        try {
            return objectMapper.writeValueAsString(event);
        } catch (Exception exception) {
            throw new IllegalStateException("Kafka event envelope serialization failed", exception);
        }
    }

    EventEnvelope<Map<String, Object>> deserialize(String value) {
        try {
            JsonNode root = objectMapper.readTree(value);
            return new EventEnvelope<>(
                    UUID.fromString(root.required("eventId").asText()),
                    root.required("eventType").asText(),
                    root.required("schemaVersion").asInt(),
                    Instant.parse(root.required("occurredAt").asText()),
                    root.required("correlationId").asText(),
                    objectMapper.convertValue(root.required("payload"), PAYLOAD_TYPE));
        } catch (Exception exception) {
            throw new IllegalArgumentException("invalid Kafka event envelope", exception);
        }
    }
}
