package com.bidflow.runtime;

import com.bidflow.application.outbox.OutboxEvent;
import com.bidflow.application.outbox.OutboxPublication;
import java.util.LinkedHashMap;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

final class OutboxTimingLog {
    private static final Logger LOG = LoggerFactory.getLogger(OutboxTimingLog.class);
    private OutboxTimingLog() { }

    static void publication(OutboxPublication observation) {
        var fields = base(observation.event());
        boolean success = observation.outcome() == OutboxPublication.Outcome.PUBLISHED;
        fields.put("event", success ? "event.published" : "event.publish.failed");
        fields.put("outcome", observation.outcome().name());
        if (observation.batchWaitMs() != null) fields.put("batchWaitMs", observation.batchWaitMs().toString());
        write(fields, success);
    }

    static void send(OutboxEvent event, boolean success, Double duration, Integer partition, Long offset) {
        var fields = base(event);
        fields.put("event", success ? "event.acknowledged" : "event.send.failed");
        fields.put("outcome", success ? "ACKNOWLEDGED" : "SEND_FAILED");
        if (duration != null) fields.put(success ? "sendAckMs" : "sendAttemptMs", duration.toString());
        if (success) {
            fields.put("partition", partition.toString());
            fields.put("offset", offset.toString());
        }
        write(fields, success);
    }

    private static Map<String, String> base(OutboxEvent event) {
        var fields = new LinkedHashMap<String, String>();
        fields.put("eventId", event.eventId().toString());
        fields.put("correlationId", event.correlationId());
        fields.put("topic", event.topic());
        fields.put("eventType", event.eventType());
        Long age = event.pendingAgeMs();
        fields.put("pendingAgeStatus", age == null ? "MISSING" : age < 0 ? "INVALID" : "VALID");
        if (age != null && age >= 0) fields.put("pendingAgeMs", age.toString());
        return fields;
    }

    private static void write(Map<String, String> fields, boolean success) {
        try (var scope = LogContext.fields(fields)) {
            if (success) LOG.info("outbox timing"); else LOG.warn("outbox timing");
        } catch (RuntimeException ignored) { /* Log transport must not change publication state. */ }
    }
}
