package com.bidflow.runtime;

import com.bidflow.adapters.persistence.JdbcOutboxRepository;
import com.bidflow.application.outbox.*;
import com.bidflow.event.EventEnvelope;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.kafka.core.KafkaTemplate;

@Configuration
class OutboxConfiguration {
    @Bean OutboxRepository outboxRepository(JdbcTemplate jdbc) { return new JdbcOutboxRepository(jdbc); }
    @Bean EventMessagePublisher eventMessagePublisher(KafkaTemplate<String, String> kafka, ObjectMapper objectMapper) {
        return event -> kafka.send(event.topic(), event.key(), serialize(event, objectMapper)).join();
    }
    @Bean OutboxPublisher outboxPublisher(OutboxRepository repository, EventMessagePublisher publisher) { return new OutboxPublisher(repository, publisher); }

    private static String serialize(com.bidflow.application.outbox.OutboxEvent event, ObjectMapper objectMapper) {
        try {
            var payload = objectMapper.readValue(event.payload(), new TypeReference<java.util.Map<String, Object>>() {});
            return objectMapper.writeValueAsString(new EventEnvelope<>(
                    event.eventId(), event.eventType(), 1, event.occurredAt(), event.correlationId(), payload));
        } catch (Exception exception) {
            throw new IllegalStateException("outbox event payload serialization failed", exception);
        }
    }
}
