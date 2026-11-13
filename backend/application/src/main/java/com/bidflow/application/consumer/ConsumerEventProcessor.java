package com.bidflow.application.consumer;

/** Runs a projection effect at most once for a consumer/event pair. */
@FunctionalInterface
public interface ConsumerEventProcessor {
    void processIfFirst(ConsumerEvent event, Runnable effect);
}
