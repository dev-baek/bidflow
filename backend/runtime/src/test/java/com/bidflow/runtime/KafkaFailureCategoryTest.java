package com.bidflow.runtime;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.junit.jupiter.api.Test;

class KafkaFailureCategoryTest {
    @Test
    void classifiesMalformedContractsWithoutARetry() {
        assertThat(KafkaFailureCategory.from(new IllegalArgumentException("invalid event")))
                .isEqualTo(KafkaFailureCategory.CONTRACT_INVALID);
    }

    @Test
    void classifiesInfrastructureFailuresForRetryBeforeDlt() {
        assertThat(KafkaFailureCategory.from(new IllegalStateException("redis unavailable")))
                .isEqualTo(KafkaFailureCategory.TRANSIENT_EXHAUSTED);
    }

    @Test
    void preservesTheOriginalKafkaLocationInContractFailureHeaders() {
        KafkaFailureConfiguration configuration = new KafkaFailureConfiguration(
                Clock.fixed(Instant.parse("2030-01-01T12:00:00Z"), ZoneOffset.UTC));
        var headers = configuration.failureHeaders(new ConsumerRecord<>("bid-event", 2, 41L, "auction-1", "{}"),
                new IllegalArgumentException("invalid event"));

        assertThat(value(headers, "x-original-topic")).isEqualTo("bid-event");
        assertThat(value(headers, "x-original-partition")).isEqualTo("2");
        assertThat(value(headers, "x-original-offset")).isEqualTo("41");
        assertThat(value(headers, "x-failure-class")).isEqualTo("CONTRACT_INVALID");
        assertThat(value(headers, "x-failed-at")).isEqualTo("2030-01-01T12:00:00Z");
    }

    private static String value(org.apache.kafka.common.header.Headers headers, String key) {
        return new String(headers.lastHeader(key).value(), StandardCharsets.UTF_8);
    }
}
