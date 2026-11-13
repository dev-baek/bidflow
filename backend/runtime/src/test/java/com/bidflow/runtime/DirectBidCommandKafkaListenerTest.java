package com.bidflow.runtime;

import static org.assertj.core.api.Assertions.assertThat;

import com.bidflow.application.bid.BidLedgerRepository;
import com.bidflow.application.bid.BidSettlementCommand;
import com.bidflow.application.bid.DirectBidProcessor;
import com.bidflow.application.bid.DirectBidResult;
import com.bidflow.application.bid.DirectBidResultCode;
import com.bidflow.application.consumer.ConsumerEvent;
import com.bidflow.application.consumer.ConsumerEventProcessor;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Clock;
import java.time.Instant;
import java.util.HashSet;
import java.util.Set;
import java.util.UUID;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.junit.jupiter.api.Test;

class DirectBidCommandKafkaListenerTest {
    private static final UUID EVENT_ID = UUID.fromString("00000000-0000-0000-0000-000000000001");
    private static final UUID REQUEST_ID = UUID.fromString("00000000-0000-0000-0000-000000000002");
    private static final UUID AUCTION_ID = UUID.fromString("00000000-0000-0000-0000-000000000003");

    @Test
    void settlesTheSameKafkaEventOnlyOnce() {
        CapturingDirectProcessor processor = new CapturingDirectProcessor();
        CapturingLedger ledger = new CapturingLedger();
        DirectBidCommandKafkaListener listener = new DirectBidCommandKafkaListener(new ObjectMapper(), processor,
                command -> { throw new AssertionError("AUTO_MAX must not run"); }, ledger, new DuplicateIgnoringProcessor(), Clock.systemUTC());
        ConsumerRecord<String, String> record = new ConsumerRecord<>("bid-command", 0, 11L, AUCTION_ID.toString(), event());

        listener.consume(record);
        listener.consume(record);

        assertThat(processor.calls).isEqualTo(1);
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
}
