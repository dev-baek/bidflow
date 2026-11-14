package com.bidflow.runtime;

import com.bidflow.application.search.SearchIndexingService;
import com.bidflow.application.consumer.ConsumerEvent;
import com.bidflow.application.consumer.ConsumerEventProcessor;
import com.bidflow.event.EventContractValidator;
import com.bidflow.event.EventContracts;
import com.bidflow.event.EventEnvelope;
import com.bidflow.event.EventEnvelopeValidator;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.time.Clock;
import java.time.Instant;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

@Component
class SearchIndexingKafkaListener {
    private static final Set<String> KNOWN_EVENT_TYPES = EventContracts.all().stream().map(contract -> contract.eventType()).collect(java.util.stream.Collectors.toUnmodifiableSet());
    private final ObjectMapper objectMapper;
    private final SearchIndexingService indexingService;
    private final ConsumerEventProcessor events;
    private final Clock clock;

    SearchIndexingKafkaListener(ObjectMapper objectMapper, SearchIndexingService indexingService, ConsumerEventProcessor events, Clock clock) {
        this.objectMapper = objectMapper;
        this.indexingService = indexingService;
        this.events = events;
        this.clock = clock;
    }

    @KafkaListener(topics = {"listing-event", "bid-event"}, groupId = "search-projection")
    void consume(ConsumerRecord<String, String> record) {
        EventEnvelope<Map<String, Object>> event = deserialize(record.value());
        try (LogContext.Scope ignored = LogContext.kafka(event.correlationId(), record, "search-projection", event.eventId().toString())) {
            if (!EventEnvelopeValidator.validate(event, Instant.now(clock), Duration.ofMinutes(1), KNOWN_EVENT_TYPES).isEmpty()
                    || !EventContractValidator.validate(record.topic(), record.key(), event).isEmpty()) {
                throw new IllegalArgumentException("invalid search projection event");
            }
            events.processIfFirst(new ConsumerEvent("search-projection", event.eventId(), record.topic(), record.partition(), record.offset(), Instant.now(clock)),
                    () -> index(event));
        }
    }

    private void index(EventEnvelope<Map<String, Object>> event) {
        switch (event.eventType()) {
            case "ListingPublished", "ListingUpdated", "ListingUnpublished" -> indexingService.indexProduct(uuid(event.payload(), "productId"));
            case "AuctionExtended", "AuctionEnded" -> indexingService.indexAuction(uuid(event.payload(), "auctionId"));
            default -> { }
        }
    }

    private EventEnvelope<Map<String, Object>> deserialize(String value) {
        try {
            JsonNode root = objectMapper.readTree(value);
            return new EventEnvelope<>(
                    UUID.fromString(root.required("eventId").asText()),
                    root.required("eventType").asText(),
                    root.required("schemaVersion").asInt(),
                    Instant.parse(root.required("occurredAt").asText()),
                    root.required("correlationId").asText(),
                    objectMapper.convertValue(root.required("payload"), new TypeReference<Map<String, Object>>() {}));
        } catch (Exception exception) {
            throw new IllegalArgumentException("invalid Kafka event envelope", exception);
        }
    }

    private static UUID uuid(Map<String, Object> payload, String field) {
        try {
            return UUID.fromString(String.valueOf(payload.get(field)));
        } catch (Exception exception) {
            throw new IllegalArgumentException("invalid event identifier: " + field, exception);
        }
    }
}
