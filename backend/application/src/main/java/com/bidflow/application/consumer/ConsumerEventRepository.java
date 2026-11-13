package com.bidflow.application.consumer;

/** Durable idempotency boundary for Kafka consumers. */
public interface ConsumerEventRepository {
    /** @return true only when this consumer has not handled the event before. */
    boolean markProcessed(ConsumerEvent event);
}
