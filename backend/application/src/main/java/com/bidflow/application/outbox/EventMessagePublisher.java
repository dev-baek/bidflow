package com.bidflow.application.outbox;

@FunctionalInterface
public interface EventMessagePublisher {
    void publish(OutboxEvent event);
}
