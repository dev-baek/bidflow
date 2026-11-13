package com.bidflow.runtime;

import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Instant;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.apache.kafka.common.TopicPartition;
import org.apache.kafka.common.header.Headers;
import org.apache.kafka.common.header.internals.RecordHeaders;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.kafka.listener.CommonErrorHandler;
import org.springframework.kafka.listener.DeadLetterPublishingRecoverer;
import org.springframework.kafka.listener.DefaultErrorHandler;
import org.springframework.kafka.support.ExponentialBackOffWithMaxRetries;

@Configuration
class KafkaFailureConfiguration {
    private final Clock clock;

    KafkaFailureConfiguration(Clock clock) {
        this.clock = clock;
    }

    @Bean
    CommonErrorHandler kafkaErrorHandler(KafkaTemplate<Object, Object> kafkaTemplate) {
        DeadLetterPublishingRecoverer recoverer = new DeadLetterPublishingRecoverer(kafkaTemplate,
                (record, exception) -> new TopicPartition(record.topic() + ".DLT", record.partition()));
        recoverer.setHeadersFunction(this::failureHeaders);

        ExponentialBackOffWithMaxRetries backOff = new ExponentialBackOffWithMaxRetries(3);
        backOff.setInitialInterval(1_000L);
        backOff.setMultiplier(2.0d);
        backOff.setMaxInterval(4_000L);

        DefaultErrorHandler handler = new DefaultErrorHandler(recoverer, backOff);
        handler.addNotRetryableExceptions(IllegalArgumentException.class);
        return handler;
    }

    Headers failureHeaders(ConsumerRecord<?, ?> record, Exception exception) {
        RecordHeaders headers = new RecordHeaders();
        add(headers, "x-original-topic", record.topic());
        add(headers, "x-original-partition", String.valueOf(record.partition()));
        add(headers, "x-original-offset", String.valueOf(record.offset()));
        add(headers, "x-failure-class", KafkaFailureCategory.from(exception).name());
        add(headers, "x-exception-type", exception.getClass().getName());
        add(headers, "x-exception-message", String.valueOf(exception.getMessage()));
        add(headers, "x-failed-at", Instant.now(clock).toString());
        return headers;
    }

    private static void add(Headers headers, String name, String value) {
        headers.add(name, value.getBytes(StandardCharsets.UTF_8));
    }
}
