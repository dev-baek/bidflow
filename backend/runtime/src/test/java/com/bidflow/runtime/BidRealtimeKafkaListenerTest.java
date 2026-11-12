package com.bidflow.runtime;

import static org.assertj.core.api.Assertions.assertThat;

import com.bidflow.application.realtime.AuctionRealtimeSnapshot;
import com.bidflow.application.realtime.AuctionRealtimeSnapshotReader;
import com.bidflow.application.realtime.RealtimeMessage;
import com.bidflow.application.realtime.RealtimeMessagePublisher;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Optional;
import java.util.UUID;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.junit.jupiter.api.Test;

class BidRealtimeKafkaListenerTest {
    private static final UUID AUCTION_ID = UUID.fromString("00000000-0000-0000-0000-000000000001");
    private static final UUID REQUEST_ID = UUID.fromString("00000000-0000-0000-0000-000000000002");

    @Test
    void broadcastsSanitizedAuctionStateAndSendsAcceptedResultOnlyToTheBidder() throws Exception {
        CapturingPublisher publisher = new CapturingPublisher();
        BidRealtimeKafkaListener listener = listener(publisher);

        listener.consume(record("BidAccepted", """
                {"bidRequestId":"%s","auctionId":"%s","bidderId":"bidder-2","currentPrice":13000,"auctionVersion":2,"processedAt":"2030-01-01T12:00:00Z","isHighestBidder":true}
                """.formatted(REQUEST_ID, AUCTION_ID)));

        assertThat(publisher.messages).hasSize(2);
        RealtimeMessage publicMessage = publisher.messages.stream().filter(message -> !message.hasRecipient()).findFirst().orElseThrow();
        JsonNode publicPayload = new ObjectMapper().readTree(publicMessage.payload());
        assertThat(publicPayload.required("type").asText()).isEqualTo("auction.updated");
        assertThat(publicPayload.required("currentPrice").asLong()).isEqualTo(13_000L);
        assertThat(publicPayload.has("bidderId")).isFalse();

        RealtimeMessage privateMessage = publisher.messages.stream().filter(RealtimeMessage::hasRecipient).findFirst().orElseThrow();
        JsonNode privatePayload = new ObjectMapper().readTree(privateMessage.payload());
        assertThat(privateMessage.recipientId()).isEqualTo("bidder-2");
        assertThat(privatePayload.required("decision").asText()).isEqualTo("ACCEPTED");
        assertThat(privatePayload.required("isHighestBidder").asBoolean()).isTrue();
    }

    @Test
    void sendsARejectedResultPrivatelyWithoutBroadcastingTheReason() throws Exception {
        CapturingPublisher publisher = new CapturingPublisher();
        BidRealtimeKafkaListener listener = listener(publisher);

        listener.consume(record("BidRejected", """
                {"bidRequestId":"%s","auctionId":"%s","bidderId":"bidder-2","reason":"BID_TOO_LOW","auctionVersion":2,"processedAt":"2030-01-01T12:00:00Z"}
                """.formatted(REQUEST_ID, AUCTION_ID)));

        assertThat(publisher.messages).hasSize(1);
        RealtimeMessage message = publisher.messages.getFirst();
        JsonNode payload = new ObjectMapper().readTree(message.payload());
        assertThat(message.recipientId()).isEqualTo("bidder-2");
        assertThat(payload.required("decision").asText()).isEqualTo("REJECTED");
        assertThat(payload.required("reason").asText()).isEqualTo("BID_TOO_LOW");
    }

    private static BidRealtimeKafkaListener listener(CapturingPublisher publisher) {
        AuctionRealtimeSnapshot snapshot = new AuctionRealtimeSnapshot(AUCTION_ID, 13_000L, Instant.parse("2030-01-01T12:05:00Z"), "ACTIVE", 2L);
        AuctionRealtimeSnapshotReader reader = auctionId -> Optional.of(snapshot);
        return new BidRealtimeKafkaListener(new ObjectMapper(), reader, publisher);
    }

    private static ConsumerRecord<String, String> record(String eventType, String payload) {
        return new ConsumerRecord<>("bid-event", 0, 0L, AUCTION_ID.toString(), """
                {"eventId":"%s","eventType":"%s","schemaVersion":1,"occurredAt":"%s","correlationId":"request-1","payload":%s}
                """.formatted(UUID.randomUUID(), eventType, Instant.now(), payload));
    }

    private static final class CapturingPublisher implements RealtimeMessagePublisher {
        private final ArrayList<RealtimeMessage> messages = new ArrayList<>();
        @Override public void publish(RealtimeMessage message) { messages.add(message); }
    }
}
