package com.bidflow.runtime;

import com.bidflow.application.outbox.OutboxPublisher;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import java.time.Instant;

@Component
class OutboxScheduler {
    private final OutboxPublisher publisher;
    OutboxScheduler(OutboxPublisher publisher) { this.publisher = publisher; }
    @Scheduled(fixedDelayString = "${bidflow.outbox.fixed-delay-ms:1000}")
    void publishPending() { publisher.publishPending(Instant.now()); }
}
