package com.bidflow.runtime;

import com.bidflow.application.outbox.EventMessagePublisher;
import com.bidflow.application.outbox.OutboxEvent;
import com.bidflow.application.outbox.OutboxPublication;
import com.bidflow.event.EventEnvelope;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.Map;
import java.util.function.LongSupplier;
import org.springframework.kafka.core.KafkaTemplate;

final class KafkaOutboxEventPublisher implements EventMessagePublisher {
    private final KafkaTemplate<String, String> kafka;
    private final ObjectMapper mapper;
    private final EventEnvelopeJsonCodec codec;
    private final LongSupplier ticker;

    KafkaOutboxEventPublisher(KafkaTemplate<String, String> kafka, ObjectMapper mapper, LongSupplier ticker) {
        this.kafka = kafka; this.mapper = mapper; this.codec = new EventEnvelopeJsonCodec(mapper); this.ticker = ticker;
    }

    @Override public void publish(OutboxEvent event) {
        long start = ticker.getAsLong();
        org.apache.kafka.clients.producer.RecordMetadata metadata;
        try {
            Map<String, Object> payload = mapper.readValue(event.payload(), new TypeReference<>() {});
            String value = codec.serialize(new EventEnvelope<>(event.eventId(), event.eventType(), 1, event.occurredAt(), event.correlationId(), payload));
            metadata = kafka.send(event.topic(), event.key(), value).join().getRecordMetadata();
        } catch (Exception failure) {
            OutboxTimingLog.send(event, false, OutboxPublication.elapsedMillis(start, ticker.getAsLong()), null, null);
            if (failure instanceof RuntimeException runtime) throw runtime;
            throw new IllegalStateException("outbox event publish failed", failure);
        }
        OutboxTimingLog.send(event, true, OutboxPublication.elapsedMillis(start, ticker.getAsLong()), metadata.partition(), metadata.offset());
    }
}
