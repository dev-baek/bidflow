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
        OutboxPublisher publisher = new OutboxPublisher(outbox, message -> {}, () -> 0L, report -> {});

        int published = publisher.publishPending(Instant.parse("2026-11-12T00:00:01Z"));

        assertThat(published).isEqualTo(1);
        assertThat(outbox.publishedEventIds).containsExactly(event.eventId());
    }

    @Test
    void leavesOutboxUnpublishedWhenBrokerFails() {
        OutboxEvent event = event();
        InMemoryOutbox outbox = new InMemoryOutbox(event);
        var reports = new java.util.ArrayList<OutboxPublication>();
        OutboxPublisher publisher = new OutboxPublisher(outbox, message -> { throw new IllegalStateException("broker unavailable"); }, () -> 0L, reports::add);

        assertThatThrownBy(() -> publisher.publishPending(Instant.parse("2026-11-12T00:00:01Z")))
                .isInstanceOf(IllegalStateException.class);
        assertThat(outbox.publishedEventIds).isEmpty();
        assertThat(reports.getFirst().outcome()).isEqualTo(OutboxPublication.Outcome.PUBLISH_FAILED);
    }

    @Test void invalidTimerAndObserverFailureDoNotBlockPublishing() {
        var reports = new java.util.ArrayList<OutboxPublication>();
        long[] ticks = {100L, 0L};
        var i = new java.util.concurrent.atomic.AtomicInteger();
        var outbox = new InMemoryOutbox(event());
        var publisher = new OutboxPublisher(outbox, e -> {}, () -> ticks[i.getAndIncrement()], report -> {
            reports.add(report); throw new IllegalStateException("observer unavailable");
        });
        assertThat(publisher.publishPending(Instant.EPOCH)).isEqualTo(1);
        assertThat(outbox.publishedEventIds).hasSize(1);
        assertThat(reports.getFirst().batchWaitMs()).isNull();
        assertThat(OutboxPublication.elapsedMillis(7, 7)).isEqualTo(0.0);
    }

    @Test void laterEventsIncludeWaitingBehindEarlierBatchEntries() {
        var first = event();
        var second = new OutboxEvent(UUID.randomUUID(), first.topic(), first.key(), first.correlationId(), first.eventType(), first.payload(), first.occurredAt(), 0L);
        var tick = new java.util.concurrent.atomic.AtomicLong();
        var reports = new java.util.ArrayList<OutboxPublication>();
        var writtenTimes = new java.util.ArrayList<Instant>();
        var repository = new OutboxRepository() {
            public List<OutboxEvent> findPending() { return List.of(first, second); }
            public void markPublished(UUID id, Instant at) { writtenTimes.add(at); }
        };
        var publisher = new OutboxPublisher(repository, e -> tick.addAndGet(10_000_000L), tick::get, reports::add);
        assertThat(publisher.publishPending(Instant.EPOCH)).isEqualTo(2);
        assertThat(reports).extracting(OutboxPublication::batchWaitMs).containsExactly(0.0, 10.0);
        assertThat(reports).extracting(OutboxPublication::outcome).containsOnly(OutboxPublication.Outcome.PUBLISHED);
        assertThat(writtenTimes).containsExactly(Instant.EPOCH, Instant.EPOCH);
    }

    @Test void observesBatchWaitAndDistinguishesAcknowledgementFromMarkFailure() {
        var reports = new java.util.ArrayList<OutboxPublication>();
        long[] ticks = {100_000_000L, 150_000_000L};
        var position = new java.util.concurrent.atomic.AtomicInteger();
        var outbox = new OutboxRepository() {
            public List<OutboxEvent> findPending() { return List.of(event()); }
            public void markPublished(UUID id, Instant at) { throw new IllegalStateException("mark failed"); }
        };
        var publisher = new OutboxPublisher(outbox, e -> {}, () -> ticks[position.getAndIncrement()], reports::add);
        assertThatThrownBy(() -> publisher.publishPending(Instant.EPOCH)).hasMessage("mark failed");
        assertThat(reports).hasSize(1);
        assertThat(reports.getFirst().outcome()).isEqualTo(OutboxPublication.Outcome.MARK_FAILED);
        assertThat(reports.getFirst().batchWaitMs()).isEqualTo(50.0);
    }

    private static OutboxEvent event() {
        return new OutboxEvent(UUID.fromString("00000000-0000-0000-0000-000000000001"), "listing-event", "product-1", "request-1", "ListingPublished", "{\"productId\":\"product-1\"}", Instant.parse("2026-11-12T00:00:00Z"), null);
    }

    private static final class InMemoryOutbox implements OutboxRepository {
        private final List<OutboxEvent> events;
        private final java.util.ArrayList<UUID> publishedEventIds = new java.util.ArrayList<>();
        private InMemoryOutbox(OutboxEvent event) { this.events = List.of(event); }
        public List<OutboxEvent> findPending() { return events; }
        public void markPublished(UUID eventId, Instant publishedAt) { publishedEventIds.add(eventId); }
    }
}
