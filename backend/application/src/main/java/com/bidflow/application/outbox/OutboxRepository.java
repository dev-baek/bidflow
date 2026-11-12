package com.bidflow.application.outbox;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

public interface OutboxRepository {
    List<OutboxEvent> findPending();
    void markPublished(UUID eventId, Instant publishedAt);
}
