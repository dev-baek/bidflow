package com.bidflow.runtime;

import com.bidflow.application.bid.BidLedgerRepository;
import com.bidflow.application.bid.BidSettlementCommand;
import com.bidflow.application.bid.AutoBidCommand;
import com.bidflow.application.bid.AutoBidProcessor;
import com.bidflow.application.bid.DirectBidCommand;
import com.bidflow.application.bid.DirectBidProcessor;
import com.bidflow.application.bid.DirectBidResult;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Clock;
import java.time.Instant;
import java.util.UUID;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Component;

/**
 * Imperative shell for direct bid settlement. An exception escapes this listener, so the configured
 * record acknowledgement does not commit its Kafka offset before PostgreSQL settlement succeeds.
 */
@Component
class DirectBidCommandKafkaListener {
    private final ObjectMapper objectMapper;
    private final DirectBidProcessor directBidProcessor;
    private final AutoBidProcessor autoBidProcessor;
    private final BidLedgerRepository ledger;
    private final Clock clock;

    DirectBidCommandKafkaListener(ObjectMapper objectMapper, DirectBidProcessor directBidProcessor, AutoBidProcessor autoBidProcessor, BidLedgerRepository ledger, Clock clock) {
        this.objectMapper = objectMapper;
        this.directBidProcessor = directBidProcessor;
        this.autoBidProcessor = autoBidProcessor;
        this.ledger = ledger;
        this.clock = clock;
    }

    @KafkaListener(topics = "bid-command", groupId = "bid-settlement")
    void consume(ConsumerRecord<String, String> record) {
        BidCommandPayload payload = parse(record.value());
        Instant now = Instant.now(clock);
        DirectBidResult result = switch (payload.bidKind()) {
            case "DIRECT" -> directBidProcessor.execute(new DirectBidCommand(
                    payload.bidRequestId(), payload.auctionId(), payload.bidderId(), payload.amount(), now));
            case "AUTO_MAX" -> autoBidProcessor.execute(new AutoBidCommand(
                    payload.bidRequestId(), payload.auctionId(), payload.bidderId(), payload.amount(), now));
            default -> throw new IllegalArgumentException("unsupported bid kind");
        };
        ledger.persist(new BidSettlementCommand(
                payload.bidRequestId(), payload.auctionId(), payload.bidderId(), payload.amount(), result, now, payload.correlationId()));
    }

    private BidCommandPayload parse(String value) {
        try {
            JsonNode envelope = objectMapper.readTree(value);
            if (!"BidCommandRequested".equals(envelope.required("eventType").asText())) {
                throw new IllegalArgumentException("unexpected bid command event");
            }
            JsonNode payload = envelope.required("payload");
            return new BidCommandPayload(
                    UUID.fromString(payload.required("bidRequestId").asText()),
                    UUID.fromString(payload.required("auctionId").asText()),
                    payload.required("bidderId").asText(),
                    payload.required("bidKind").asText(),
                    payload.required("amount").asLong(),
                    envelope.required("correlationId").asText());
        } catch (Exception exception) {
            throw new IllegalArgumentException("invalid bid command event", exception);
        }
    }

    private record BidCommandPayload(UUID bidRequestId, UUID auctionId, String bidderId, String bidKind, long amount, String correlationId) {
    }
}
