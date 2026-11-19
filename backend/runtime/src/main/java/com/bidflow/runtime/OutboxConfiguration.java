package com.bidflow.runtime;

import com.bidflow.adapters.persistence.JdbcOutboxRepository;
import com.bidflow.application.outbox.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.kafka.core.KafkaTemplate;

@Configuration
class OutboxConfiguration {
    @Bean OutboxRepository outboxRepository(JdbcTemplate jdbc) { return new JdbcOutboxRepository(jdbc); }
    @Bean EventMessagePublisher eventMessagePublisher(KafkaTemplate<String, String> kafka, ObjectMapper objectMapper) {
        return new KafkaOutboxEventPublisher(kafka, objectMapper, System::nanoTime);
    }
    @Bean OutboxPublisher outboxPublisher(OutboxRepository repository, EventMessagePublisher publisher) {
        return new OutboxPublisher(repository, publisher, System::nanoTime, OutboxTimingLog::publication);
    }
}
