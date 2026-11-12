package com.bidflow.event;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class EventEnvelopeValidatorTest {

    private static final UUID EVENT_ID =
            UUID.fromString("b9347c5f-b02f-4a67-89c9-2d2272ed1a32");
    private static final Instant VALIDATION_TIME = Instant.parse("2026-07-29T00:00:00Z");
    private static final Duration ALLOWED_FUTURE_SKEW = Duration.ofMinutes(1);
    private static final Set<String> KNOWN_TYPES = Set.of("AuctionCreated");
    private static final Map<String, String> PAYLOAD = Map.of("auctionId", "auction-1");

    @Test
    void acceptsAnEnvelopeThatSatisfiesTheContract() {
        assertThat(validate(envelope(
                        EVENT_ID,
                        "AuctionCreated",
                        1,
                        VALIDATION_TIME,
                        "request-1",
                        PAYLOAD)))
                .isEmpty();
    }

    @Test
    void rejectsAMissingEventId() {
        assertThat(validate(envelope(
                        null,
                        "AuctionCreated",
                        1,
                        VALIDATION_TIME,
                        "request-1",
                        PAYLOAD)))
                .containsExactly(EventEnvelopeViolation.EVENT_ID_REQUIRED);
    }

    @Test
    void rejectsABlankEventType() {
        assertThat(validate(envelope(
                        EVENT_ID,
                        " ",
                        1,
                        VALIDATION_TIME,
                        "request-1",
                        PAYLOAD)))
                .containsExactly(EventEnvelopeViolation.EVENT_TYPE_REQUIRED);
    }

    @Test
    void rejectsAnUnknownEventType() {
        assertThat(validate(envelope(
                        EVENT_ID,
                        "UnknownEvent",
                        1,
                        VALIDATION_TIME,
                        "request-1",
                        PAYLOAD)))
                .containsExactly(EventEnvelopeViolation.EVENT_TYPE_UNKNOWN);
    }

    @Test
    void rejectsASchemaVersionLowerThanOne() {
        assertThat(validate(envelope(
                        EVENT_ID,
                        "AuctionCreated",
                        0,
                        VALIDATION_TIME,
                        "request-1",
                        PAYLOAD)))
                .containsExactly(EventEnvelopeViolation.SCHEMA_VERSION_INVALID);
    }

    @Test
    void rejectsAMissingOccurrenceTime() {
        assertThat(validate(envelope(
                        EVENT_ID,
                        "AuctionCreated",
                        1,
                        null,
                        "request-1",
                        PAYLOAD)))
                .containsExactly(EventEnvelopeViolation.OCCURRED_AT_REQUIRED);
    }

    @Test
    void rejectsAnOccurrenceTimeBeyondTheAllowedFutureSkew() {
        assertThat(validate(envelope(
                        EVENT_ID,
                        "AuctionCreated",
                        1,
                        VALIDATION_TIME.plusSeconds(61),
                        "request-1",
                        PAYLOAD)))
                .containsExactly(EventEnvelopeViolation.OCCURRED_AT_TOO_FAR_IN_FUTURE);
    }

    @Test
    void rejectsABlankCorrelationId() {
        assertThat(validate(envelope(
                        EVENT_ID,
                        "AuctionCreated",
                        1,
                        VALIDATION_TIME,
                        " ",
                        PAYLOAD)))
                .containsExactly(EventEnvelopeViolation.CORRELATION_ID_REQUIRED);
    }

    @Test
    void rejectsAMissingPayload() {
        assertThat(validate(envelope(
                        EVENT_ID,
                        "AuctionCreated",
                        1,
                        VALIDATION_TIME,
                        "request-1",
                        null)))
                .containsExactly(EventEnvelopeViolation.PAYLOAD_REQUIRED);
    }

    @Test
    void returnsAnImmutableViolationList() {
        List<EventEnvelopeViolation> violations = validate(envelope(
                null,
                "AuctionCreated",
                1,
                VALIDATION_TIME,
                "request-1",
                PAYLOAD));

        assertThatThrownBy(() -> violations.add(EventEnvelopeViolation.PAYLOAD_REQUIRED))
                .isInstanceOf(UnsupportedOperationException.class);
    }

    private static List<EventEnvelopeViolation> validate(EventEnvelope<?> envelope) {
        return EventEnvelopeValidator.validate(
                envelope,
                VALIDATION_TIME,
                ALLOWED_FUTURE_SKEW,
                KNOWN_TYPES);
    }

    private static EventEnvelope<Map<String, String>> envelope(
            UUID eventId,
            String eventType,
            int schemaVersion,
            Instant occurredAt,
            String correlationId,
            Map<String, String> payload) {
        return new EventEnvelope<>(
                eventId,
                eventType,
                schemaVersion,
                occurredAt,
                correlationId,
                payload);
    }
}
