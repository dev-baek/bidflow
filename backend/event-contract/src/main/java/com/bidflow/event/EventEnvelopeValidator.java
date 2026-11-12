package com.bidflow.event;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;

public final class EventEnvelopeValidator {

    private EventEnvelopeValidator() {
    }

    public static List<EventEnvelopeViolation> validate(
            EventEnvelope<?> envelope,
            Instant validationTime,
            Duration allowedFutureSkew,
            Set<String> knownEventTypes
    ) {
        List<EventEnvelopeViolation> violations = new ArrayList<>();

        if (envelope.eventId() == null) {
            violations.add(EventEnvelopeViolation.EVENT_ID_REQUIRED);
        }
        if (envelope.eventType() == null || envelope.eventType().isBlank()) {
            violations.add(EventEnvelopeViolation.EVENT_TYPE_REQUIRED);
        } else if (!knownEventTypes.contains(envelope.eventType())) {
            violations.add(EventEnvelopeViolation.EVENT_TYPE_UNKNOWN);
        }
        if (envelope.schemaVersion() < 1) {
            violations.add(EventEnvelopeViolation.SCHEMA_VERSION_INVALID);
        }
        if (envelope.occurredAt() == null) {
            violations.add(EventEnvelopeViolation.OCCURRED_AT_REQUIRED);
        } else if (envelope.occurredAt().isAfter(validationTime.plus(allowedFutureSkew))) {
            violations.add(EventEnvelopeViolation.OCCURRED_AT_TOO_FAR_IN_FUTURE);
        }
        if (envelope.correlationId() == null || envelope.correlationId().isBlank()) {
            violations.add(EventEnvelopeViolation.CORRELATION_ID_REQUIRED);
        }
        if (envelope.payload() == null) {
            violations.add(EventEnvelopeViolation.PAYLOAD_REQUIRED);
        }

        return List.copyOf(violations);
    }
}
