package com.bidflow.runtime;

import com.bidflow.application.consumer.ConsumerEvent;
import com.bidflow.application.consumer.ConsumerEventProcessor;
import com.bidflow.application.consumer.ConsumerEventRepository;
import org.springframework.transaction.support.TransactionTemplate;

/** Keeps a consumer's durable deduplication record and its local effect in one transaction. */
final class TransactionalConsumerEventProcessor implements ConsumerEventProcessor {
    private final ConsumerEventRepository events;
    private final TransactionTemplate transaction;

    TransactionalConsumerEventProcessor(ConsumerEventRepository events, TransactionTemplate transaction) {
        this.events = events;
        this.transaction = transaction;
    }

    @Override
    public void processIfFirst(ConsumerEvent event, Runnable effect) {
        transaction.executeWithoutResult(status -> {
            if (events.markProcessed(event)) effect.run();
        });
    }
}
