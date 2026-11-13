package com.bidflow.runtime;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.bidflow.application.auction.AuctionActiveStateCleaner;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Instant;
import java.util.ArrayList;
import java.util.UUID;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.junit.jupiter.api.Test;

class AuctionEndedKafkaListenerTest {
    private static final UUID AUCTION_ID = UUID.fromString("00000000-0000-0000-0000-000000000001");

    @Test
    void clearsTheEndedAuctionsActiveRedisStateAndAllowsReplay() {
        CapturingCleaner cleaner = new CapturingCleaner();
        AuctionEndedKafkaListener listener = new AuctionEndedKafkaListener(new ObjectMapper(), cleaner);
        ConsumerRecord<String, String> event = event("AuctionEnded", """
                {"auctionId":"%s","outcome":"SOLD","winnerId":"bidder-1","finalPrice":13000,"auctionVersion":5,"endedAt":"2030-01-01T12:00:00Z"}
                """.formatted(AUCTION_ID));

        listener.consume(event);
        listener.consume(event);

        assertThat(cleaner.auctionIds).containsExactly(AUCTION_ID, AUCTION_ID);
    }

    @Test
    void doesNotClearRedisForOtherBidEvents() {
        CapturingCleaner cleaner = new CapturingCleaner();
        AuctionEndedKafkaListener listener = new AuctionEndedKafkaListener(new ObjectMapper(), cleaner);

        listener.consume(event("BidRejected", """
                {"bidRequestId":"%s","auctionId":"%s","bidderId":"bidder-1","reason":"BID_TOO_LOW","auctionVersion":4,"processedAt":"2030-01-01T12:00:00Z"}
                """.formatted(UUID.randomUUID(), AUCTION_ID)));

        assertThat(cleaner.auctionIds).isEmpty();
    }

    @Test
    void rejectsAnEndedEventThatBreaksTheContract() {
        AuctionEndedKafkaListener listener = new AuctionEndedKafkaListener(new ObjectMapper(), new CapturingCleaner());

        assertThatThrownBy(() -> listener.consume(event("AuctionEnded", "{" + "\"auctionId\":\"" + AUCTION_ID + "\"}")))
                .isInstanceOf(IllegalArgumentException.class);
    }

    private static ConsumerRecord<String, String> event(String eventType, String payload) {
        return new ConsumerRecord<>("bid-event", 0, 0L, AUCTION_ID.toString(), """
                {"eventId":"%s","eventType":"%s","schemaVersion":1,"occurredAt":"%s","correlationId":"auction-close","payload":%s}
                """.formatted(UUID.randomUUID(), eventType, Instant.now(), payload));
    }

    private static final class CapturingCleaner implements AuctionActiveStateCleaner {
        private final ArrayList<UUID> auctionIds = new ArrayList<>();
        @Override public void clear(UUID auctionId) { auctionIds.add(auctionId); }
    }
}
