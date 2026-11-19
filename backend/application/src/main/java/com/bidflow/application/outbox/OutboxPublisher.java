package com.bidflow.application.outbox;

import java.time.Instant;
import java.util.function.Consumer;
import java.util.function.LongSupplier;

public final class OutboxPublisher {
    private final OutboxRepository repository;
    private final EventMessagePublisher publisher;
    private final LongSupplier ticker;
    private final Consumer<OutboxPublication> observer;
    public OutboxPublisher(OutboxRepository repository, EventMessagePublisher publisher, LongSupplier ticker, Consumer<OutboxPublication> observer) {
        this.repository = repository; this.publisher = publisher; this.ticker = ticker; this.observer = observer;
    }
    public int publishPending(Instant publishedAt) {
        int count = 0;
        var pending = repository.findPending();
        long selected = ticker.getAsLong();
        for (OutboxEvent event : pending) {
            Double batchWait = OutboxPublication.elapsedMillis(selected, ticker.getAsLong());
            try { publisher.publish(event); }
            catch (RuntimeException failure) {
                observe(new OutboxPublication(event, OutboxPublication.Outcome.PUBLISH_FAILED, batchWait));
                throw failure;
            }
            try { repository.markPublished(event.eventId(), publishedAt); }
            catch (RuntimeException failure) {
                observe(new OutboxPublication(event, OutboxPublication.Outcome.MARK_FAILED, batchWait));
                throw failure;
            }
            observe(new OutboxPublication(event, OutboxPublication.Outcome.PUBLISHED, batchWait));
            count++;
        }
        return count;
    }

    private void observe(OutboxPublication observation) {
        try { observer.accept(observation); }
        catch (RuntimeException ignored) { /* Telemetry must not change publish/mark outcomes. */ }
    }
}
