package com.bidflow.runtime;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import java.util.function.Supplier;
import org.apache.kafka.clients.consumer.Consumer;
import org.apache.kafka.clients.consumer.KafkaConsumer;
import org.apache.kafka.clients.producer.KafkaProducer;
import org.apache.kafka.clients.producer.Producer;
import org.apache.kafka.common.TopicPartition;
import org.apache.kafka.common.serialization.ByteArrayDeserializer;
import org.apache.kafka.common.serialization.ByteArraySerializer;

/** Standalone local operator tool; deliberately does not start Spring. */
public final class ListingEventReplayCli {
    record Options(String bootstrap, int partition, long offset, UUID eventId, String operator, Path audit) {
        static Options parse(String[] args) {
            if (args.length != 5 && args.length != 7) throw usage();
            if (!args[0].matches("(localhost|127\\.0\\.0\\.1|\\[::1\\]):[0-9]{1,5}")) throw usage();
            int port = Integer.parseInt(args[0].substring(args[0].lastIndexOf(':') + 1));
            if (port < 1 || port > 65535 || !args[1].matches("[0-9]+") || !args[2].matches("[0-9]+")
                    || args[4].isBlank() || args[4].length() > 128 || args[4].codePoints().anyMatch(Character::isISOControl)) throw usage();
            if (args.length == 7 && (!args[6].equals("--execute") || args[5].isBlank())) throw usage();
            return new Options(args[0], Integer.parseInt(args[1]), Long.parseLong(args[2]), UUID.fromString(args[3]),
                    args[4], args.length == 7 ? Path.of(args[5]).toAbsolutePath().normalize() : null);
        }
    }

    public static void main(String[] args) {
        try {
            Options options = Options.parse(args);
            Path repo = Path.of("").toRealPath();
            while (!Files.exists(repo.resolve(".git"))) {
                repo = repo.getParent();
                if (repo == null) throw new IllegalArgumentException("run from BidFlow repository");
            }
            try (var consumer = new KafkaConsumer<byte[], byte[]>(consumerProperties(options))) {
                run(options, consumer, () -> new KafkaProducer<>(producerProperties(options)), repo, Instant.now(), UUID.randomUUID());
            }
        } catch (Exception failure) {
            System.err.println("Replay failed; do not retry automatically. Check the audit file for ATTEMPTED/UNKNOWN. "
                    + "Usage: bootstrap partition offset eventId operator [external-audit-file --execute]");
            System.exit(1);
        }
    }

    static Map<String, Object> consumerProperties(Options options) {
        return Map.of("bootstrap.servers", options.bootstrap(), "key.deserializer", ByteArrayDeserializer.class,
                "value.deserializer", ByteArrayDeserializer.class, "enable.auto.commit", false,
                "auto.offset.reset", "none", "allow.auto.create.topics", false, "max.poll.records", 1,
                "max.partition.fetch.bytes", 1_048_576, "default.api.timeout.ms", 3_000);
    }

    static Map<String, Object> producerProperties(Options options) {
        return Map.of("bootstrap.servers", options.bootstrap(), "key.serializer", ByteArraySerializer.class,
                "value.serializer", ByteArraySerializer.class, "acks", "all", "enable.idempotence", false,
                "retries", 0, "max.block.ms", 3_000, "delivery.timeout.ms", 5_000, "request.timeout.ms", 3_000);
    }

    static void run(Options options, Consumer<byte[], byte[]> consumer, Supplier<Producer<byte[], byte[]>> producers,
                    Path repository, Instant now, UUID replayId) throws Exception {
        var partition = new TopicPartition("listing-event.DLT", options.partition());
        consumer.assign(List.of(partition));
        consumer.seek(partition, options.offset());
        ListingEventReplayPlan plan = null;
        for (int poll = 0; poll < 10 && plan == null; poll++) {
            var records = consumer.poll(Duration.ofSeconds(1));
            var iterator = records.iterator();
            if (iterator.hasNext()) plan = ListingEventReplayPlan.prepare(iterator.next(), options.partition(), options.offset(),
                    options.eventId(), replayId, options.operator(), now);
        }
        if (plan == null) throw new IOException("DLT record not available within polling limit");
        int targetPartition = plan.originalPartition();
        if (consumer.partitionsFor("listing-event", Duration.ofSeconds(3)).stream().noneMatch(p -> p.partition() == targetPartition)) {
            throw new IOException("original partition unavailable");
        }
        if (options.audit() == null) {
            System.out.println("DRY_RUN valid eventId=" + plan.eventId() + "; no record published");
            return;
        }
        Path parent = options.audit().getParent().toRealPath();
        Path audit = parent.resolve(options.audit().getFileName());
        if (audit.startsWith(repository.toRealPath())) throw new IOException("audit must be outside repository");
        try (var file = FileChannel.open(audit, StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE)) {
            publish(plan, options, producers, file, now, replayId);
        }
        System.out.println("PUBLISHED; verify consumer_event and search API separately");
    }

    static void publish(ListingEventReplayPlan plan, Options options, Supplier<Producer<byte[], byte[]>> producers,
                        FileChannel audit, Instant now, UUID replayId) throws Exception {
        var entry = new LinkedHashMap<String, Object>();
        entry.put("replayId", replayId.toString());
        entry.put("replayedAt", now.toString());
        entry.put("operator", options.operator());
        entry.put("eventId", plan.eventId().toString());
        entry.put("dltTopic", "listing-event.DLT");
        entry.put("dltPartition", options.partition());
        entry.put("dltOffset", options.offset());
        entry.put("originalTopic", "listing-event");
        entry.put("originalPartition", plan.originalPartition());
        entry.put("originalOffset", plan.originalOffset());
        append(audit, entry, "ATTEMPTED");
        try {
            var producer = producers.get();
            try {
                var metadata = producer.send(plan.record()).get(6, TimeUnit.SECONDS);
                if (!metadata.topic().equals("listing-event") || metadata.partition() != plan.originalPartition() || metadata.offset() < 0) {
                    throw new IOException("invalid acknowledgement");
                }
                entry.put("targetTopic", metadata.topic());
                entry.put("targetPartition", metadata.partition());
                entry.put("targetOffset", metadata.offset());
                append(audit, entry, "PUBLISHED");
            } finally {
                producer.close(Duration.ofSeconds(2));
            }
        } catch (Exception failure) {
            if (failure instanceof InterruptedException) Thread.currentThread().interrupt();
            try { append(audit, entry, "UNKNOWN"); } catch (IOException ignored) { /* ATTEMPTED remains the recovery marker. */ }
            throw new IOException("UNKNOWN: check broker and audit before retrying");
        }
    }

    private static void append(FileChannel audit, Map<String, Object> entry, String result) throws IOException {
        entry.put("result", result);
        ByteBuffer bytes = StandardCharsets.UTF_8.encode(new ObjectMapper().writeValueAsString(entry) + "\n");
        while (bytes.hasRemaining()) audit.write(bytes);
        audit.force(true);
    }

    private static IllegalArgumentException usage() { return new IllegalArgumentException("invalid replay arguments"); }
}
