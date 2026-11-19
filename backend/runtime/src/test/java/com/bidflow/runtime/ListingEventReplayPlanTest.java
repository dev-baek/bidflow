package com.bidflow.runtime;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.UUID;
import java.util.function.Consumer;
import java.util.stream.Stream;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;

class ListingEventReplayPlanTest {
    private static final UUID EVENT = UUID.fromString("18326eec-aa93-4eb1-b1c3-3d23e7de163c");
    private static final UUID REPLAY = UUID.fromString("632605c9-a77c-416c-939c-9391424970bf");
    private static final String PRODUCT = "92a8a9eb-4f5a-464c-83d7-7cbd8c31454e";
    private static final Instant NOW = Instant.parse("2030-01-01T12:00:00Z");

    @Test
    void keepsOriginalBytesAndPartitionAndAddsOnlyReplayHeaders() {
        var source = source();
        var plan = ListingEventReplayPlan.prepare(source, 2, 9, EVENT, REPLAY, "operator", NOW);
        var record = plan.record();
        assertThat(record.topic()).isEqualTo("listing-event");
        assertThat(record.partition()).isEqualTo(1);
        assertThat(record.key()).isEqualTo(source.key());
        assertThat(record.value()).containsExactly(source.value());
        assertThat(plan.originalOffset()).isEqualTo(41);
        assertThat(plan.eventId()).isEqualTo(EVENT);
        assertThat(record.headers()).extracting(h -> h.key())
                .containsExactly("x-replay-id", "x-replayed-at", "x-replayed-by");
        assertThat(new String(record.headers().lastHeader("x-replay-id").value(), StandardCharsets.UTF_8))
                .isEqualTo(REPLAY.toString());
        assertThat(source.headers().lastHeader("x-replay-id")).isNull();
    }

    @ParameterizedTest
    @MethodSource("badHeaders")
    void rejectsMissingDuplicateOrInvalidHeaders(Consumer<ConsumerRecord<byte[], byte[]>> change) {
        var source = source();
        change.accept(source);
        assertThatThrownBy(() -> ListingEventReplayPlan.prepare(source, 2, 9, EVENT, REPLAY, "operator", NOW))
                .isInstanceOf(IllegalArgumentException.class);
    }

    static Stream<Consumer<ConsumerRecord<byte[], byte[]>>> badHeaders() {
        return Stream.of(
                r -> r.headers().remove("x-original-topic"),
                r -> add(r, "x-original-topic", "listing-event"),
                r -> replace(r, "x-original-topic", "bid-command"),
                r -> replace(r, "x-original-partition", "-1"),
                r -> replace(r, "x-original-offset", "oops"),
                r -> replace(r, "x-failure-class", "CONTRACT_INVALID"));
    }

    @Test
    void rejectsWrongDltPositionExpectedIdAndBlankOperator() {
        assertThatThrownBy(() -> ListingEventReplayPlan.prepare(source(), 1, 9, EVENT, REPLAY, "operator", NOW)).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> ListingEventReplayPlan.prepare(source(), 2, 10, EVENT, REPLAY, "operator", NOW)).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> ListingEventReplayPlan.prepare(source(), 2, 9, UUID.randomUUID(), REPLAY, "operator", NOW)).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> ListingEventReplayPlan.prepare(source(), 2, 9, EVENT, REPLAY, " ", NOW)).isInstanceOf(IllegalArgumentException.class);
    }

    @ParameterizedTest
    @org.junit.jupiter.params.provider.ValueSource(strings = {"{}", "{}{}", "null", "broken"})
    void rejectsMalformedJson(String value) {
        var source = new ConsumerRecord<>("listing-event.DLT", 2, 9L, source().key(), value.getBytes(StandardCharsets.UTF_8));
        source().headers().forEach(h -> source.headers().add(h));
        assertThatThrownBy(() -> ListingEventReplayPlan.prepare(source, 2, 9, EVENT, REPLAY, "operator", NOW)).isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void rejectsOtherTopicsKeysTombstonesAndOversizedOrInvalidUtf8() {
        var valid = source();
        var wrongTopic = new ConsumerRecord<>("bid-command.DLT", 2, 9L, valid.key(), valid.value());
        assertThatThrownBy(() -> ListingEventReplayPlan.prepare(wrongTopic, 2, 9, EVENT, REPLAY, "operator", NOW))
                .isInstanceOf(IllegalArgumentException.class);
        for (byte[] key : new byte[][] { null, "other-product".getBytes(StandardCharsets.UTF_8) }) {
            var record = new ConsumerRecord<>(valid.topic(), 2, 9L, key, valid.value());
            valid.headers().forEach(h -> record.headers().add(h));
            assertThatThrownBy(() -> ListingEventReplayPlan.prepare(record, 2, 9, EVENT, REPLAY, "operator", NOW))
                    .isInstanceOf(IllegalArgumentException.class);
        }
        for (byte[] value : new byte[][] { null, new byte[1_048_577], new byte[] { (byte) 0xff } }) {
            var record = new ConsumerRecord<>(valid.topic(), 2, 9L, valid.key(), value);
            valid.headers().forEach(h -> record.headers().add(h));
            assertThatThrownBy(() -> ListingEventReplayPlan.prepare(record, 2, 9, EVENT, REPLAY, "operator", NOW))
                    .isInstanceOf(IllegalArgumentException.class);
        }
    }

    @ParameterizedTest
    @org.junit.jupiter.params.provider.ValueSource(strings = {"ListingPublished", "ListingUpdated", "ListingUnpublished"})
    void acceptsTheThreeSearchSnapshotEventTypes(String type) throws Exception {
        var original = source();
        var mapper = new ObjectMapper();
        var root = (com.fasterxml.jackson.databind.node.ObjectNode) mapper.readTree(original.value());
        root.put("eventType", type);
        var payload = (com.fasterxml.jackson.databind.node.ObjectNode) root.get("payload");
        payload.put("sellerId", "test-seller").put("title", "test-title").put("categoryId", "DIGITAL")
                .put("publishedAt", NOW.toString()).put("updatedAt", NOW.toString());
        var record = new ConsumerRecord<>(original.topic(), 2, 9L, original.key(), mapper.writeValueAsBytes(root));
        original.headers().forEach(h -> record.headers().add(h));
        assertThat(ListingEventReplayPlan.prepare(record, 2, 9, EVENT, REPLAY, "operator", NOW).record().value())
                .containsExactly(record.value());
    }

    @ParameterizedTest
    @org.junit.jupiter.params.provider.ValueSource(strings = {"schema", "future", "product", "type", "payload"})
    void rejectsUnsupportedEnvelope(String change) throws Exception {
        var source = source();
        var json = new ObjectMapper().readTree(source.value());
        var root = (com.fasterxml.jackson.databind.node.ObjectNode) json;
        switch (change) {
            case "schema" -> root.put("schemaVersion", 2);
            case "future" -> root.put("occurredAt", NOW.plusSeconds(61).toString());
            case "product" -> ((com.fasterxml.jackson.databind.node.ObjectNode) root.get("payload")).put("productId", "bad-id");
            case "type" -> root.put("eventType", "BidCommandRequested");
            case "payload" -> root.remove("payload");
            default -> throw new AssertionError();
        }
        var changed = new ConsumerRecord<>(source.topic(), 2, 9L, source.key(), new ObjectMapper().writeValueAsBytes(root));
        source.headers().forEach(h -> changed.headers().add(h));
        assertThatThrownBy(() -> ListingEventReplayPlan.prepare(changed, 2, 9, EVENT, REPLAY, "operator", NOW)).isInstanceOf(IllegalArgumentException.class);
    }

    private static ConsumerRecord<byte[], byte[]> source() {
        String json = """
                {"eventId":"%s","eventType":"ListingUnpublished","schemaVersion":1,
                 "occurredAt":"2029-01-01T12:00:00Z","correlationId":"test-correlation",
                 "payload":{"productId":"%s","listingVersion":1,"unpublishedAt":"2029-01-01T12:00:00Z"}}
                """.formatted(EVENT, PRODUCT);
        var record = new ConsumerRecord<>("listing-event.DLT", 2, 9L, PRODUCT.getBytes(StandardCharsets.UTF_8), json.getBytes(StandardCharsets.UTF_8));
        add(record, "x-original-topic", "listing-event");
        add(record, "x-original-partition", "1");
        add(record, "x-original-offset", "41");
        add(record, "x-failure-class", "TRANSIENT_EXHAUSTED");
        return record;
    }

    private static void replace(ConsumerRecord<byte[], byte[]> r, String key, String value) { r.headers().remove(key); add(r, key, value); }
    private static void add(ConsumerRecord<byte[], byte[]> r, String key, String value) { r.headers().add(key, value.getBytes(StandardCharsets.UTF_8)); }
}
