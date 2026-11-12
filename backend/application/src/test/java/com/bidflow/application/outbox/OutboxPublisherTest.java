package com.bidflow.application.outbox;

import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class OutboxPublisherTest {
    @Test
    void marksEventPublishedOnlyAfterBrokerAcknowledges() {
        OutboxEvent event = event();
        InMemoryOutbox outbox = new InMemoryOutbox(event);
        OutboxPublisher publisher = new OutboxPublisher(outbox, message -> {});

        int published = publisher.publishPending(Instant.parse("2026-11-12T00:00:01Z"));

        assertThat(published).isEqualTo(1);
        assertThat(outbox.publishedEventIds).containsExactly(event.eventId());
    }

    @Test
    void leavesOutboxUnpublishedWhenBrokerFails() {
        OutboxEvent event = event();
        InMemoryOutbox outbox = new InMemoryOutbox(event);
        OutboxPublisher publisher = new OutboxPublisher(outbox, message -> { throw new IllegalStateException("broker unavailable"); });

        assertThatThrownBy(() -> publisher.publishPending(Instant.parse("2026-11-12T00:00:01Z")))
                .isInstanceOf(IllegalStateException.class);
        assertThat(outbox.publishedEventIds).isEmpty();
    }

    private static OutboxEvent event() {
        return new OutboxEvent(UUID.fromString("00000000-0000-0000-0000-000000000001"), "listing-event", "product-1", "ListingPublished", "{\"productId\":\"product-1\"}");
    }

    private static final class InMemoryOutbox implements OutboxRepository {
        private final List<OutboxEvent> events;
        private final java.util.ArrayList<UUID> publishedEventIds = new java.util.ArrayList<>();
        private InMemoryOutbox(OutboxEvent event) { this.events = List.of(event); }
        public List<OutboxEvent> findPending() { return events; }
        public void markPublished(UUID eventId, Instant publishedAt) { publishedEventIds.add(eventId); }
    }
}
