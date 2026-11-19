package com.bidflow.runtime;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import java.nio.channels.FileChannel;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import org.apache.kafka.clients.consumer.Consumer;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.apache.kafka.clients.consumer.ConsumerRecords;
import org.apache.kafka.clients.producer.Producer;
import org.apache.kafka.clients.producer.RecordMetadata;
import org.apache.kafka.common.PartitionInfo;
import org.apache.kafka.common.TopicPartition;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

class ListingEventReplayCliTest {
    @TempDir Path temp;
    static final UUID EVENT = UUID.fromString("18326eec-aa93-4eb1-b1c3-3d23e7de163c");
    static final UUID REPLAY = UUID.randomUUID();
    static final Instant NOW = Instant.parse("2030-01-01T12:00:00Z");

    @ParameterizedTest
    @ValueSource(strings = {"broker.amazonaws.com:9092", "localhost:9092,evil:9092", "user@localhost:9092", "http://localhost:9092", "localhost:0"})
    void rejectsNonLocalBootstrap(String broker) {
        assertThatThrownBy(() -> ListingEventReplayCli.Options.parse(args(broker)))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test void dryRunDoesNotCreateProducerOrAuditFileOrCommit() throws Exception {
        var consumer = consumer(9);
        var options = ListingEventReplayCli.Options.parse(args("localhost:9092"));
        ListingEventReplayCli.run(options, consumer, () -> { throw new AssertionError("producer created"); }, temp, NOW, REPLAY);
        verify(consumer, never()).commitSync();
        verify(consumer).assign(List.of(new TopicPartition("listing-event.DLT", 2)));
        verify(consumer).seek(new TopicPartition("listing-event.DLT", 2), 9L);
        try (var files = Files.list(temp)) { assertThat(files.toList()).isEmpty(); }
    }

    @Test void usesBoundedClientsWithoutGroupCommitOrProducerRetries() {
        var options = ListingEventReplayCli.Options.parse(args("127.0.0.1:9092"));
        assertThat(ListingEventReplayCli.consumerProperties(options)).containsEntry("enable.auto.commit", false)
                .containsEntry("allow.auto.create.topics", false).containsEntry("max.poll.records", 1)
                .doesNotContainKey("group.id");
        assertThat(ListingEventReplayCli.producerProperties(options)).containsEntry("retries", 0)
                .containsEntry("enable.idempotence", false).containsEntry("acks", "all");
    }

    @Test void noRecordAndKafkaFailureDoNotCreateProducer() throws Exception {
        var consumer = consumer(9);
        var options = ListingEventReplayCli.Options.parse(args("localhost:9092"));
        when(consumer.poll(any(Duration.class))).thenReturn(ConsumerRecords.empty());
        assertThatThrownBy(() -> ListingEventReplayCli.run(options, consumer, () -> { throw new AssertionError(); }, temp, NOW, REPLAY))
                .isInstanceOf(java.io.IOException.class);
        verify(consumer, times(10)).poll(Duration.ofSeconds(1));
        when(consumer.poll(any(Duration.class))).thenThrow(new org.apache.kafka.common.errors.TimeoutException("secret"));
        assertThatThrownBy(() -> ListingEventReplayCli.run(options, consumer, () -> { throw new AssertionError(); }, temp, NOW, REPLAY))
                .isInstanceOf(org.apache.kafka.common.errors.TimeoutException.class);
    }

    @Test void executeWritesAttemptBeforeSendAndAcknowledgedLocationAfterIt() throws Exception {
        Path audit = temp.resolve("result.jsonl");
        var producer = producer();
        when(producer.send(any())).thenAnswer(call -> {
            assertThat(Files.readString(audit)).contains("ATTEMPTED").doesNotContain("PUBLISHED");
            return CompletableFuture.completedFuture(new RecordMetadata(new TopicPartition("listing-event", 1), 70, 0, 0, 0, 0));
        });
        ListingEventReplayCli.run(options(audit), consumer(9), () -> producer, repository(), NOW, REPLAY);
        assertThat(Files.readAllLines(audit)).hasSize(2);
        assertThat(Files.readString(audit)).contains("PUBLISHED", "70").doesNotContain("payload", "test-title");
        verify(producer, times(1)).send(any());
        verify(producer).close(Duration.ofSeconds(2));
    }

    @Test void existingOrRepositoryAuditFilePreventsSend() throws Exception {
        var producer = producer();
        Path audit = Files.writeString(temp.resolve("existing"), "keep");
        assertThatThrownBy(() -> ListingEventReplayCli.run(options(audit), consumer(9), () -> producer, repository(), NOW, REPLAY)).isInstanceOf(Exception.class);
        assertThat(Files.readString(audit)).isEqualTo("keep");
        assertThatThrownBy(() -> ListingEventReplayCli.run(options(temp.resolve("inside")), consumer(9), () -> producer, temp, NOW, REPLAY)).isInstanceOf(Exception.class);
        verifyNoInteractions(producer);
    }

    @Test void unavailableOffsetOrPartitionPreventsSend() throws Exception {
        var producer = producer();
        assertThatThrownBy(() -> ListingEventReplayCli.run(options(temp.resolve("missing")), consumer(10), () -> producer, temp, NOW, REPLAY)).isInstanceOf(Exception.class);
        var consumer = consumer(9);
        when(consumer.partitionsFor(eq("listing-event"), any(Duration.class))).thenReturn(List.of());
        assertThatThrownBy(() -> ListingEventReplayCli.run(options(temp.resolve("partition")), consumer, () -> producer, temp, NOW, REPLAY)).isInstanceOf(Exception.class);
        verifyNoInteractions(producer);
    }

    @Test void sendFailureIsUnknownAndNotRetried() throws Exception {
        var producer = producer();
        when(producer.send(any())).thenReturn(CompletableFuture.failedFuture(new IllegalStateException("secret error")));
        Path audit = temp.resolve("unknown.jsonl");
        assertThatThrownBy(() -> ListingEventReplayCli.run(options(audit), consumer(9), () -> producer, repository(), NOW, REPLAY))
                .hasMessageContaining("UNKNOWN");
        assertThat(Files.readString(audit)).contains("UNKNOWN").doesNotContain("secret error");
        verify(producer, times(1)).send(any());
    }

    @Test void auditFailureBeforeSendPreventsItAndAfterSendIsUnknown() throws Exception {
        var plan = ListingEventReplayPlan.prepare(record(9), 2, 9, EVENT, REPLAY, "operator", NOW);
        var producer = producer();
        var file = mock(FileChannel.class);
        when(file.write(any(java.nio.ByteBuffer.class))).thenThrow(new java.io.IOException("disk error"));
        assertThatThrownBy(() -> ListingEventReplayCli.publish(plan, options(temp.resolve("audit")), () -> producer, file, NOW, REPLAY)).isInstanceOf(java.io.IOException.class);
        verifyNoInteractions(producer);
        var postAck = mock(FileChannel.class);
        when(postAck.write(any(java.nio.ByteBuffer.class))).thenAnswer(c -> { var b = c.getArgument(0, java.nio.ByteBuffer.class); int n = b.remaining(); b.position(b.limit()); return n; });
        doNothing().doThrow(new java.io.IOException("disk full")).when(postAck).force(true);
        when(producer.send(any())).thenReturn(CompletableFuture.completedFuture(new RecordMetadata(new TopicPartition("listing-event", 1), 70, 0, 0, 0, 0)));
        assertThatThrownBy(() -> ListingEventReplayCli.publish(plan, options(temp.resolve("audit")), () -> producer, postAck, NOW, REPLAY)).hasMessageContaining("UNKNOWN");
        verify(producer, times(1)).send(any());
    }

    private Path repository() throws java.io.IOException { return Files.createDirectories(temp.resolve("repo")); }
    private String[] args(String broker) { return new String[] {broker, "2", "9", EVENT.toString(), "operator"}; }
    private ListingEventReplayCli.Options options(Path audit) { return ListingEventReplayCli.Options.parse(new String[] {"localhost:9092", "2", "9", EVENT.toString(), "operator", audit.toString(), "--execute"}); }
    @SuppressWarnings("unchecked") private Producer<byte[], byte[]> producer() { return mock(Producer.class); }
    @SuppressWarnings("unchecked") private Consumer<byte[], byte[]> consumer(long offset) {
        Consumer<byte[], byte[]> consumer = mock(Consumer.class);
        when(consumer.poll(any(Duration.class))).thenReturn(new ConsumerRecords<>(Map.of(new TopicPartition("listing-event.DLT", 2), List.of(record(offset)))));
        when(consumer.partitionsFor(eq("listing-event"), any(Duration.class))).thenReturn(List.of(new PartitionInfo("listing-event", 1, null, null, null)));
        return consumer;
    }
    private ConsumerRecord<byte[], byte[]> record(long offset) {
        String key = "92a8a9eb-4f5a-464c-83d7-7cbd8c31454e";
        String json = """
                {"eventId":"%s","eventType":"ListingUnpublished","schemaVersion":1,"occurredAt":"2029-01-01T12:00:00Z",
                "correlationId":"correlation","payload":{"productId":"%s","listingVersion":1,"unpublishedAt":"2029-01-01T12:00:00Z"}}
                """.formatted(EVENT, key);
        var record = new ConsumerRecord<>("listing-event.DLT", 2, offset, key.getBytes(StandardCharsets.UTF_8), json.getBytes(StandardCharsets.UTF_8));
        Map.of("x-original-topic", "listing-event", "x-original-partition", "1", "x-original-offset", "41", "x-failure-class", "TRANSIENT_EXHAUSTED")
                .forEach((k, v) -> record.headers().add(k, v.getBytes(StandardCharsets.UTF_8)));
        return record;
    }
}
