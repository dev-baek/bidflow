package com.bidflow.runtime;

import com.bidflow.application.auction.AuctionActiveStateCleaner;
import com.bidflow.event.EventContractValidator;
import com.bidflow.event.EventContracts;
import com.bidflow.event.EventEnvelope;
import com.bidflow.event.EventEnvelopeValidator;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Component;

/** Removes the active Redis projection only after the durable AuctionEnded event has been published. */
@Component
class AuctionEndedKafkaListener {
    private static final Set<String> KNOWN_EVENT_TYPES = EventContracts.all().stream().map(contract -> contract.eventType()).collect(java.util.stream.Collectors.toUnmodifiableSet());
    private final ObjectMapper objectMapper;
    private final AuctionActiveStateCleaner cleaner;

    AuctionEndedKafkaListener(ObjectMapper objectMapper, AuctionActiveStateCleaner cleaner) {
        this.objectMapper = objectMapper;
        this.cleaner = cleaner;
    }

    @KafkaListener(topics = "bid-event", groupId = "auction-finalization")
    void consume(ConsumerRecord<String, String> record) {
        EventEnvelope<Map<String, Object>> event = deserialize(record.value());
        if (!EventEnvelopeValidator.validate(event, Instant.now(), Duration.ofMinutes(1), KNOWN_EVENT_TYPES).isEmpty()
                || !EventContractValidator.validate(record.topic(), record.key(), event).isEmpty()) {
            throw new IllegalArgumentException("invalid auction finalization event");
        }
        if (!"AuctionEnded".equals(event.eventType())) return;
        cleaner.clear(UUID.fromString(String.valueOf(event.payload().get("auctionId"))));
    }

    private EventEnvelope<Map<String, Object>> deserialize(String value) {
        try {
            JsonNode root = objectMapper.readTree(value);
            return new EventEnvelope<>(UUID.fromString(root.required("eventId").asText()), root.required("eventType").asText(),
                    root.required("schemaVersion").asInt(), Instant.parse(root.required("occurredAt").asText()),
                    root.required("correlationId").asText(), objectMapper.convertValue(root.required("payload"), new TypeReference<Map<String, Object>>() {}));
        } catch (Exception exception) {
            throw new IllegalArgumentException("invalid auction finalization event", exception);
        }
    }
}
