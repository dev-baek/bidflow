package com.bidflow.application.outbox;

import java.time.Instant;

public final class OutboxPublisher {
    private final OutboxRepository repository;
    private final EventMessagePublisher publisher;
    public OutboxPublisher(OutboxRepository repository, EventMessagePublisher publisher) { this.repository = repository; this.publisher = publisher; }
    public int publishPending(Instant publishedAt) {
        int count = 0;
        for (OutboxEvent event : repository.findPending()) {
            publisher.publish(event);
            repository.markPublished(event.eventId(), publishedAt);
            count++;
        }
        return count;
    }
}
