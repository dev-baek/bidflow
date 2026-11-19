package com.bidflow.runtime;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.AppenderBase;
import com.bidflow.application.outbox.OutboxEvent;
import com.bidflow.application.outbox.OutboxPublication;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.atomic.AtomicInteger;
import org.apache.kafka.clients.producer.ProducerRecord;
import org.apache.kafka.clients.producer.RecordMetadata;
import org.apache.kafka.common.TopicPartition;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.kafka.support.SendResult;

class OutboxTimingTest {
    @Test void logsAcknowledgementTimingAndKeepsEnvelopeUnchanged() throws Exception {
        try (var logs = new Capture()) {
            var kafka = kafka();
            var metadata = new RecordMetadata(new TopicPartition("listing-event", 2), 42, 0, 0, 0, 0);
            when(kafka.send(anyString(), anyString(), anyString())).thenReturn(CompletableFuture.completedFuture(
                    new SendResult<>(new ProducerRecord<>("listing-event", "product", ""), metadata)));
            var payload = org.mockito.ArgumentCaptor.forClass(String.class);
            long[] ticks = {0, 50_000_000};
            var i = new AtomicInteger();
            var event = event(17L);
            new KafkaOutboxEventPublisher(kafka, new ObjectMapper().findAndRegisterModules(), () -> ticks[i.getAndIncrement()]).publish(event);
            verify(kafka).send(eq(event.topic()), eq(event.key()), payload.capture());
            var json = new ObjectMapper().readTree(payload.getValue());
            assertThat(json.get("eventId").asText()).isEqualTo(event.eventId().toString());
            assertThat(json.get("occurredAt").asText()).isEqualTo(event.occurredAt().toString());
            assertThat(json.has("pendingAgeMs")).isFalse();
            assertThat(logs.fields.getFirst()).containsEntry("sendAckMs", "50.0")
                    .containsEntry("partition", "2").containsEntry("offset", "42").containsEntry("pendingAgeMs", "17");
            assertThat(MDC.getCopyOfContextMap()).isNullOrEmpty();
        }
    }

    @Test void sendFailureDoesNotLogAckOrRawException() {
        try (var logs = new Capture()) {
            var kafka = kafka();
            when(kafka.send(anyString(), anyString(), anyString())).thenReturn(CompletableFuture.failedFuture(new IllegalStateException("token-secret")));
            assertThatThrownBy(() -> new KafkaOutboxEventPublisher(kafka, new ObjectMapper().findAndRegisterModules(), () -> 0L).publish(event(null)))
                    .isInstanceOf(java.util.concurrent.CompletionException.class);
            assertThat(logs.fields.getFirst()).containsEntry("event", "event.send.failed").containsEntry("pendingAgeStatus", "MISSING")
                    .doesNotContainKeys("sendAckMs", "partition", "offset", "pendingAgeMs");
            assertThat(logs.fields.toString()).doesNotContain("token-secret", "payload-secret");
            assertThat(logs.messages.toString()).doesNotContain("token-secret", "payload-secret");
            assertThat(MDC.getCopyOfContextMap()).isNullOrEmpty();
        }
    }

    @Test void missingAndInvalidAgeAreOmittedAndMarkFailureIsDistinct() {
        try (var logs = new Capture()) {
            OutboxTimingLog.publication(new OutboxPublication(event(-1L), OutboxPublication.Outcome.MARK_FAILED, null));
            assertThat(logs.fields.getFirst()).containsEntry("outcome", "MARK_FAILED").containsEntry("pendingAgeStatus", "INVALID")
                    .doesNotContainKeys("pendingAgeMs", "batchWaitMs", "payload", "key");
            OutboxTimingLog.publication(new OutboxPublication(event(null), OutboxPublication.Outcome.PUBLISHED, 0.0));
            assertThat(logs.fields.get(1)).containsEntry("pendingAgeStatus", "MISSING").containsEntry("batchWaitMs", "0.0");
            assertThat(MDC.getCopyOfContextMap()).isNullOrEmpty();
        }
    }

    private static OutboxEvent event(Long age) {
        return new OutboxEvent(UUID.randomUUID(), "listing-event", "product", "correlation", "ListingPublished", "{\"productId\":\"payload-secret\"}", Instant.parse("2030-01-01T00:00:00Z"), age);
    }
    @SuppressWarnings("unchecked") private static KafkaTemplate<String, String> kafka() { return mock(KafkaTemplate.class); }

    private static class Capture extends AppenderBase<ILoggingEvent> implements AutoCloseable {
        final List<Map<String, String>> fields = new ArrayList<>();
        final List<String> messages = new ArrayList<>();
        final Logger logger = (Logger) LoggerFactory.getLogger(OutboxTimingLog.class);
        Capture() { MDC.clear(); start(); logger.addAppender(this); }
        protected void append(ILoggingEvent event) { fields.add(Map.copyOf(event.getMDCPropertyMap())); messages.add(event.getFormattedMessage()); }
        public void close() { logger.detachAppender(this); stop(); MDC.clear(); }
    }
}
