package com.bidflow.runtime;

import com.bidflow.application.realtime.AuctionRealtimeSnapshot;
import com.bidflow.application.realtime.AuctionRealtimeSnapshotReader;
import com.bidflow.application.realtime.RealtimeMessage;
import com.bidflow.application.realtime.RealtimeMessagePublisher;
import com.bidflow.event.EventContractValidator;
import com.bidflow.event.EventContracts;
import com.bidflow.event.EventEnvelope;
import com.bidflow.event.EventEnvelopeValidator;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Component;

/** Converts durable bid events into sanitized Browser messages after reading the current PostgreSQL snapshot. */
@Component
class BidRealtimeKafkaListener {
    private static final Set<String> KNOWN_EVENT_TYPES = EventContracts.all().stream().map(contract -> contract.eventType()).collect(java.util.stream.Collectors.toUnmodifiableSet());
    private final ObjectMapper objectMapper;
    private final AuctionRealtimeSnapshotReader snapshots;
    private final RealtimeMessagePublisher publisher;

    BidRealtimeKafkaListener(ObjectMapper objectMapper, AuctionRealtimeSnapshotReader snapshots, RealtimeMessagePublisher publisher) {
        this.objectMapper = objectMapper;
        this.snapshots = snapshots;
        this.publisher = publisher;
    }

    @KafkaListener(topics = "bid-event", groupId = "realtime-projection")
    void consume(ConsumerRecord<String, String> record) {
        EventEnvelope<Map<String, Object>> event = deserialize(record.value());
        if (!EventEnvelopeValidator.validate(event, Instant.now(), Duration.ofMinutes(1), KNOWN_EVENT_TYPES).isEmpty()
                || !EventContractValidator.validate(record.topic(), record.key(), event).isEmpty()) {
            throw new IllegalArgumentException("invalid realtime bid event");
        }
        UUID auctionId = uuid(event.payload(), "auctionId");
        AuctionRealtimeSnapshot snapshot = snapshots.findByAuctionId(auctionId)
                .orElseThrow(() -> new IllegalStateException("auction snapshot is unavailable"));
        switch (event.eventType()) {
            case "BidAccepted" -> {
                publishPublic(event, snapshot, "auction.updated");
                publishBidResult(event, snapshot, "ACCEPTED");
            }
            case "BidRejected" -> publishBidResult(event, snapshot, "REJECTED");
            case "AuctionExtended" -> publishPublic(event, snapshot, "auction.updated");
            case "AuctionEnded" -> publishPublic(event, snapshot, "auction.ended");
            default -> throw new IllegalArgumentException("unsupported realtime bid event");
        }
    }

    private void publishPublic(EventEnvelope<Map<String, Object>> event, AuctionRealtimeSnapshot snapshot, String type) {
        Map<String, Object> payload = publicPayload(event, snapshot, type);
        if ("auction.ended".equals(type)) payload.put("outcome", value(event.payload(), "outcome"));
        publisher.publish(new RealtimeMessage(event.eventId(), snapshot.auctionId(), null, json(payload)));
    }

    private void publishBidResult(EventEnvelope<Map<String, Object>> event, AuctionRealtimeSnapshot snapshot, String decision) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("type", "bid.result");
        payload.put("eventId", event.eventId().toString());
        payload.put("bidRequestId", value(event.payload(), "bidRequestId"));
        payload.put("auctionId", snapshot.auctionId().toString());
        payload.put("auctionVersion", snapshot.auctionVersion());
        payload.put("occurredAt", event.occurredAt().toString());
        payload.put("decision", decision);
        payload.put("reason", "REJECTED".equals(decision) ? value(event.payload(), "reason") : null);
        payload.put("currentPrice", snapshot.currentPrice());
        payload.put("endsAt", snapshot.endsAt().toString());
        payload.put("isHighestBidder", "ACCEPTED".equals(decision) && Boolean.parseBoolean(value(event.payload(), "isHighestBidder")));
        publisher.publish(new RealtimeMessage(event.eventId(), snapshot.auctionId(), value(event.payload(), "bidderId"), json(payload)));
    }

    private static Map<String, Object> publicPayload(EventEnvelope<Map<String, Object>> event, AuctionRealtimeSnapshot snapshot, String type) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("type", type);
        payload.put("eventId", event.eventId().toString());
        payload.put("auctionId", snapshot.auctionId().toString());
        payload.put("auctionVersion", snapshot.auctionVersion());
        payload.put("occurredAt", event.occurredAt().toString());
        payload.put("currentPrice", snapshot.currentPrice());
        payload.put("endsAt", snapshot.endsAt().toString());
        payload.put("status", snapshot.status());
        return payload;
    }

    private EventEnvelope<Map<String, Object>> deserialize(String value) {
        try {
            JsonNode root = objectMapper.readTree(value);
            return new EventEnvelope<>(UUID.fromString(root.required("eventId").asText()), root.required("eventType").asText(),
                    root.required("schemaVersion").asInt(), Instant.parse(root.required("occurredAt").asText()),
                    root.required("correlationId").asText(), objectMapper.convertValue(root.required("payload"), new TypeReference<Map<String, Object>>() {}));
        } catch (Exception exception) {
            throw new IllegalArgumentException("invalid bid event", exception);
        }
    }

    private static UUID uuid(Map<String, Object> payload, String field) {
        try { return UUID.fromString(value(payload, field)); }
        catch (Exception exception) { throw new IllegalArgumentException("invalid event identifier: " + field, exception); }
    }

    private static String value(Map<String, Object> payload, String field) {
        Object value = payload.get(field);
        if (value == null) throw new IllegalArgumentException("missing event field: " + field);
        return value.toString();
    }

    private String json(Map<String, Object> payload) {
        try { return objectMapper.writeValueAsString(payload); }
        catch (Exception exception) { throw new IllegalStateException("realtime payload serialization failed", exception); }
    }
}
