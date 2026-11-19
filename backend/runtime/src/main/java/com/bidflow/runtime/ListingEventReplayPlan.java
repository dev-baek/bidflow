package com.bidflow.runtime;

import com.bidflow.event.EventContractValidator;
import com.bidflow.event.EventEnvelopeValidator;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.Set;
import java.util.UUID;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.apache.kafka.clients.producer.ProducerRecord;
import org.apache.kafka.common.header.Headers;

/** Pure validation and record construction; does not access Kafka, files, or the clock. */
record ListingEventReplayPlan(UUID eventId, String correlationId, int originalPartition, long originalOffset,
                              ProducerRecord<byte[], byte[]> record) {
    private static final Set<String> TYPES = Set.of("ListingPublished", "ListingUpdated", "ListingUnpublished");
    private static final int MAX_BYTES = 1_048_576;

    static ListingEventReplayPlan prepare(ConsumerRecord<byte[], byte[]> source, int dltPartition, long dltOffset,
                                         UUID expectedEventId, UUID replayId, String operator, Instant now) {
        if (source == null || expectedEventId == null || replayId == null || now == null
                || operator == null || operator.isBlank() || operator.length() > 128
                || operator.codePoints().anyMatch(Character::isISOControl)
                || dltPartition < 0 || dltOffset < 0 || !source.topic().equals("listing-event.DLT")
                || source.partition() != dltPartition || source.offset() != dltOffset) {
            throw invalid();
        }
        if (!header(source.headers(), "x-original-topic").equals("listing-event")
                || !header(source.headers(), "x-failure-class").equals("TRANSIENT_EXHAUSTED")) throw invalid();
        int originalPartition;
        long originalOffset;
        try {
            originalPartition = Integer.parseInt(nonNegative(header(source.headers(), "x-original-partition")));
            originalOffset = Long.parseLong(nonNegative(header(source.headers(), "x-original-offset")));
        } catch (NumberFormatException exception) {
            throw invalid();
        }

        String key = utf8(source.key(), 128);
        String value = utf8(source.value(), MAX_BYTES);
        var mapper = new ObjectMapper().enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS);
        var event = new EventEnvelopeJsonCodec(mapper).deserialize(value);
        if (event.schemaVersion() != 1 || !event.eventId().equals(expectedEventId)
                || !EventEnvelopeValidator.validate(event, now, Duration.ofMinutes(1), TYPES).isEmpty()
                || !EventContractValidator.validate("listing-event", key, event).isEmpty()) throw invalid();
        try {
            if (!UUID.fromString(key).toString().equals(key)) throw invalid();
        } catch (IllegalArgumentException exception) {
            throw invalid();
        }

        var record = new ProducerRecord<>("listing-event", originalPartition, source.key().clone(), source.value().clone());
        record.headers().add("x-replay-id", replayId.toString().getBytes(StandardCharsets.UTF_8));
        record.headers().add("x-replayed-at", now.toString().getBytes(StandardCharsets.UTF_8));
        record.headers().add("x-replayed-by", operator.getBytes(StandardCharsets.UTF_8));
        return new ListingEventReplayPlan(event.eventId(), event.correlationId(), originalPartition, originalOffset, record);
    }

    private static String header(Headers headers, String name) {
        var values = headers.headers(name).iterator();
        if (!values.hasNext()) throw invalid();
        String value = utf8(values.next().value(), 256);
        if (values.hasNext()) throw invalid();
        return value;
    }

    private static String nonNegative(String number) {
        if (!number.matches("[0-9]{1,19}")) throw invalid();
        return number;
    }

    private static String utf8(byte[] bytes, int max) {
        if (bytes == null || bytes.length == 0 || bytes.length > max) throw invalid();
        try {
            return StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
                    .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString();
        } catch (CharacterCodingException exception) {
            throw invalid();
        }
    }

    private static IllegalArgumentException invalid() {
        return new IllegalArgumentException("invalid listing DLT replay record or metadata");
    }
}
