package com.bidflow.runtime;

import com.bidflow.application.bid.BidLedgerRepository;
import com.bidflow.application.bid.BidSettlementCommand;
import com.bidflow.application.bid.AutoBidCommand;
import com.bidflow.application.bid.AutoBidMaximum;
import com.bidflow.application.bid.AutoBidMaximumRepository;
import com.bidflow.application.bid.AuctionRecoveryResult;
import com.bidflow.application.bid.AuctionStateRecoveryService;
import com.bidflow.application.bid.AutoBidProcessor;
import com.bidflow.application.bid.DirectBidCommand;
import com.bidflow.application.bid.DirectBidProcessor;
import com.bidflow.application.bid.DirectBidResult;
import com.bidflow.application.bid.DirectBidResultCode;
import com.bidflow.application.consumer.ConsumerEvent;
import com.bidflow.application.consumer.ConsumerEventProcessor;
import com.bidflow.event.EventEnvelope;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Clock;
import java.time.Instant;
import java.util.UUID;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Component;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import java.util.Map;

/**
 * Imperative shell for direct bid settlement. An exception escapes this listener, so the configured
 * record acknowledgement does not commit its Kafka offset before PostgreSQL settlement succeeds.
 */
@Component
class DirectBidCommandKafkaListener {
    static final String LISTENER_ID = "bid-settlement";
    private static final Logger log = LoggerFactory.getLogger(DirectBidCommandKafkaListener.class);
    private final EventEnvelopeJsonCodec codec;
    private final DirectBidProcessor directBidProcessor;
    private final AutoBidProcessor autoBidProcessor;
    private final BidLedgerRepository ledger;
    private final AutoBidMaximumRepository automaticMaxima;
    private final AuctionStateRecoveryService recovery;
    private final ConsumerEventProcessor events;
    private final Clock clock;

    DirectBidCommandKafkaListener(ObjectMapper objectMapper, DirectBidProcessor directBidProcessor, AutoBidProcessor autoBidProcessor,
            BidLedgerRepository ledger, AutoBidMaximumRepository automaticMaxima, AuctionStateRecoveryService recovery,
            ConsumerEventProcessor events, Clock clock) {
        this.codec = new EventEnvelopeJsonCodec(objectMapper);
        this.directBidProcessor = directBidProcessor;
        this.autoBidProcessor = autoBidProcessor;
        this.ledger = ledger;
        this.automaticMaxima = automaticMaxima;
        this.recovery = recovery;
        this.events = events;
        this.clock = clock;
    }

    @KafkaListener(id = LISTENER_ID, topics = "bid-command", groupId = "bid-settlement")
    void consume(ConsumerRecord<String, String> record) {
        BidCommandPayload payload = parse(record.value());
        try (LogContext.Scope ignored = LogContext.kafka(payload.correlationId(), record, "bid-settlement", payload.eventId().toString())) {
            Instant now = Instant.now(clock);
            events.processIfFirst(new ConsumerEvent("bid-settlement", payload.eventId(), record.topic(), record.partition(), record.offset(), now),
                    () -> settle(payload, now));
        }
    }

    private void settle(BidCommandPayload payload, Instant now) {
        DirectBidResult result = execute(payload, now);
        if (result.code() == DirectBidResultCode.NOT_ACTIVE) result = recoverAndExecute(payload, now);
        boolean persisted = ledger.persist(new BidSettlementCommand(
                payload.bidRequestId(), payload.auctionId(), payload.bidderId(), payload.amount(), result, now, payload.correlationId()));
        if (persisted) {
            try (LogContext.Scope ignored = LogContext.fields(Map.of("event", "bid.settled", "bidRequestId", payload.bidRequestId().toString(),
                    "auctionId", payload.auctionId().toString(), "outcome", result.code().name()))) {
                log.info("bid settlement completed");
            }
        }
        if (persisted && "AUTO_MAX".equals(payload.bidKind()) && result.code() == DirectBidResultCode.ACCEPTED) {
            automaticMaxima.save(new AutoBidMaximum(payload.auctionId(), payload.bidderId(), payload.amount()));
        }
    }

    private DirectBidResult recoverAndExecute(BidCommandPayload payload, Instant now) {
        AuctionRecoveryResult recovered = recovery.recover(payload.auctionId(), now);
        if (recovered.ended()) {
            return new DirectBidResult(DirectBidResultCode.AUCTION_ENDED, recovered.snapshot().currentPrice(),
                    recovered.snapshot().winnerId(), recovered.snapshot().winnerMaximum(), recovered.snapshot().endsAt(), recovered.snapshot().version());
        }
        DirectBidResult retried = execute(payload, now);
        if (retried.code() == DirectBidResultCode.NOT_ACTIVE) {
            throw new IllegalStateException("auction state was not restored");
        }
        return retried;
    }

    private DirectBidResult execute(BidCommandPayload payload, Instant now) {
        return switch (payload.bidKind()) {
            case "DIRECT" -> directBidProcessor.execute(new DirectBidCommand(
                    payload.bidRequestId(), payload.auctionId(), payload.bidderId(), payload.amount(), now));
            case "AUTO_MAX" -> autoBidProcessor.execute(new AutoBidCommand(
                    payload.bidRequestId(), payload.auctionId(), payload.bidderId(), payload.amount(), now));
            default -> throw new IllegalArgumentException("unsupported bid kind");
        };
    }

    private BidCommandPayload parse(String value) {
        try {
            EventEnvelope<Map<String, Object>> envelope = codec.deserialize(value);
            if (!"BidCommandRequested".equals(envelope.eventType())) {
                throw new IllegalArgumentException("unexpected bid command event");
            }
            Map<String, Object> payload = envelope.payload();
            return new BidCommandPayload(
                    envelope.eventId(),
                    UUID.fromString(required(payload, "bidRequestId")),
                    UUID.fromString(required(payload, "auctionId")),
                    required(payload, "bidderId"),
                    required(payload, "bidKind"),
                    Long.parseLong(required(payload, "amount")),
                    envelope.correlationId());
        } catch (Exception exception) {
            throw new IllegalArgumentException("invalid bid command event", exception);
        }
    }

    private static String required(Map<String, Object> payload, String field) {
        Object value = payload.get(field);
        if (value == null) throw new IllegalArgumentException("missing bid command field: " + field);
        return value.toString();
    }

    private record BidCommandPayload(UUID eventId, UUID bidRequestId, UUID auctionId, String bidderId, String bidKind, long amount, String correlationId) {
    }
}
