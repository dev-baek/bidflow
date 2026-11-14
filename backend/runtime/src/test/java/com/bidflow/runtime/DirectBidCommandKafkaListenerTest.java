package com.bidflow.runtime;

import static org.assertj.core.api.Assertions.assertThat;

import com.bidflow.application.bid.BidLedgerRepository;
import com.bidflow.application.bid.BidSettlementCommand;
import com.bidflow.application.bid.AuctionRecoverySnapshot;
import com.bidflow.application.bid.AuctionStateRecoveryService;
import com.bidflow.application.bid.AuctionStateRepository;
import com.bidflow.application.bid.AuctionRedisState;
import com.bidflow.application.bid.DirectBidProcessor;
import com.bidflow.application.bid.DirectBidResult;
import com.bidflow.application.bid.DirectBidResultCode;
import com.bidflow.application.consumer.ConsumerEvent;
import com.bidflow.application.consumer.ConsumerEventProcessor;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Clock;
import java.time.Instant;
import java.time.Duration;
import java.util.List;
import java.util.Optional;
import java.util.HashSet;
import java.util.Set;
import java.util.UUID;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.AfterEach;
import org.slf4j.MDC;

class DirectBidCommandKafkaListenerTest {
    private static final UUID EVENT_ID = UUID.fromString("00000000-0000-0000-0000-000000000001");
    private static final UUID REQUEST_ID = UUID.fromString("00000000-0000-0000-0000-000000000002");
    private static final UUID AUCTION_ID = UUID.fromString("00000000-0000-0000-0000-000000000003");

    @AfterEach
    void clearMdc() {
        MDC.clear();
    }

    @Test
    void scopesKafkaCorrelationAndPositionToOneRecordOnly() {
        CapturingContextProcessor events = new CapturingContextProcessor();
        DirectBidCommandKafkaListener listener = new DirectBidCommandKafkaListener(new ObjectMapper(), new CapturingDirectProcessor(),
                command -> { throw new AssertionError("AUTO_MAX must not run"); }, new CapturingLedger(), maximum -> { }, null,
                events, Clock.systemUTC());

        listener.consume(new ConsumerRecord<>("bid-command", 2, 11L, AUCTION_ID.toString(), event()));

        assertThat(events.correlationId).isEqualTo("request-1");
        assertThat(events.topic).isEqualTo("bid-command");
        assertThat(events.partition).isEqualTo("2");
        assertThat(events.offset).isEqualTo("11");
        assertThat(events.consumerGroup).isEqualTo("bid-settlement");
        assertThat(MDC.getCopyOfContextMap()).isNullOrEmpty();
    }

    @Test
    void settlesTheSameKafkaEventOnlyOnce() {
        CapturingDirectProcessor processor = new CapturingDirectProcessor();
        CapturingLedger ledger = new CapturingLedger();
        DirectBidCommandKafkaListener listener = new DirectBidCommandKafkaListener(new ObjectMapper(), processor,
                command -> { throw new AssertionError("AUTO_MAX must not run"); }, ledger,
                maximum -> { throw new AssertionError("automatic maximum must not be stored"); }, null,
                new DuplicateIgnoringProcessor(), Clock.systemUTC());
        ConsumerRecord<String, String> record = new ConsumerRecord<>("bid-command", 0, 11L, AUCTION_ID.toString(), event());

        listener.consume(record);
        listener.consume(record);

        assertThat(processor.calls).isEqualTo(1);
        assertThat(ledger.calls).isEqualTo(1);
    }

    @Test
    void restoresADeletedRedisStateThenRetriesTheSameCommandOnce() {
        NotActiveThenAcceptedProcessor processor = new NotActiveThenAcceptedProcessor();
        CapturingLedger ledger = new CapturingLedger();
        CapturingStates states = new CapturingStates();
        AuctionStateRecoveryService recovery = new AuctionStateRecoveryService(auctionId -> Optional.of(
                new AuctionRecoverySnapshot(AUCTION_ID, com.bidflow.domain.listing.AuctionStatus.ACTIVE, 11_000L, "bidder-0", 11_000L,
                        Instant.parse("2030-01-01T11:00:00Z"), Instant.parse("2030-01-01T13:00:00Z"), 2L, List.of())),
                states, auctionId -> { });
        DirectBidCommandKafkaListener listener = new DirectBidCommandKafkaListener(new ObjectMapper(), processor,
                command -> { throw new AssertionError("AUTO_MAX must not run"); }, ledger, maximum -> { }, recovery,
                (event, effect) -> effect.run(), Clock.fixed(Instant.parse("2030-01-01T12:00:00Z"), java.time.ZoneOffset.UTC));

        listener.consume(new ConsumerRecord<>("bid-command", 0, 11L, AUCTION_ID.toString(), event()));

        assertThat(processor.calls).isEqualTo(2);
        assertThat(states.state.auctionId()).isEqualTo(AUCTION_ID);
        assertThat(ledger.calls).isEqualTo(1);
    }

    private static String event() {
        return """
                {"eventId":"%s","eventType":"BidCommandRequested","schemaVersion":1,"occurredAt":"2030-01-01T12:00:00Z",
                 "correlationId":"request-1","payload":{"bidRequestId":"%s","auctionId":"%s","bidderId":"bidder-1","bidKind":"DIRECT","amount":12000}}
                """.formatted(EVENT_ID, REQUEST_ID, AUCTION_ID);
    }

    private static final class CapturingDirectProcessor implements DirectBidProcessor {
        private int calls;
        @Override public DirectBidResult execute(com.bidflow.application.bid.DirectBidCommand command) {
            calls++;
            return new DirectBidResult(DirectBidResultCode.ACCEPTED, 12_000L, "bidder-1", 12_000L, Instant.parse("2030-01-01T13:00:00Z"), 2L);
        }
    }

    private static final class NotActiveThenAcceptedProcessor implements DirectBidProcessor {
        private int calls;
        @Override public DirectBidResult execute(com.bidflow.application.bid.DirectBidCommand command) {
            calls++;
            if (calls == 1) return new DirectBidResult(DirectBidResultCode.NOT_ACTIVE, 0L, "", 0L, Instant.EPOCH, 0L);
            return new DirectBidResult(DirectBidResultCode.ACCEPTED, 12_000L, "bidder-1", 12_000L, Instant.parse("2030-01-01T13:00:00Z"), 3L);
        }
    }

    private static final class CapturingLedger implements BidLedgerRepository {
        private int calls;
        @Override public boolean persist(BidSettlementCommand command) { calls++; return true; }
    }

    private static final class DuplicateIgnoringProcessor implements ConsumerEventProcessor {
        private final Set<String> processed = new HashSet<>();
        @Override public void processIfFirst(ConsumerEvent event, Runnable effect) {
            if (processed.add(event.consumerName() + event.eventId())) effect.run();
        }
    }

    private static final class CapturingContextProcessor implements ConsumerEventProcessor {
        private String correlationId;
        private String topic;
        private String partition;
        private String offset;
        private String consumerGroup;

        @Override public void processIfFirst(ConsumerEvent event, Runnable effect) {
            correlationId = MDC.get("correlationId");
            topic = MDC.get("topic");
            partition = MDC.get("partition");
            offset = MDC.get("offset");
            consumerGroup = MDC.get("consumerGroup");
            effect.run();
        }
    }

    private static final class CapturingStates implements AuctionStateRepository {
        private AuctionRedisState state;
        @Override public void save(AuctionRedisState value, Duration ttl) { state = value; }
        @Override public Optional<AuctionRedisState> findByAuctionId(UUID auctionId) { return Optional.empty(); }
        @Override public void saveAutoMaximum(UUID auctionId, String bidderId, long maximum, Duration ttl) { }
    }
}
