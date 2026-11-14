package com.bidflow.runtime;

import java.util.Map;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.slf4j.MDC;

final class LogContext {
    private LogContext() {
    }

    static Scope request(String correlationId) {
        MDC.clear();
        MDC.put("correlationId", correlationId);
        return MDC::clear;
    }

    static Scope kafka(String correlationId, ConsumerRecord<?, ?> record, String consumerGroup, String eventId) {
        MDC.clear();
        MDC.put("correlationId", correlationId);
        MDC.put("topic", record.topic());
        MDC.put("partition", String.valueOf(record.partition()));
        MDC.put("offset", String.valueOf(record.offset()));
        MDC.put("consumerGroup", consumerGroup);
        MDC.put("eventId", eventId);
        return MDC::clear;
    }

    static Scope fields(Map<String, String> fields) {
        fields.forEach(MDC::put);
        return () -> fields.keySet().forEach(MDC::remove);
    }

    interface Scope extends AutoCloseable {
        @Override
        void close();
    }
}
