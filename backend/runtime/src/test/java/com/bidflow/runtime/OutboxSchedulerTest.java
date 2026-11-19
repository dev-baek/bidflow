package com.bidflow.runtime;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.AppenderBase;
import com.bidflow.application.outbox.OutboxPublisher;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
import org.springframework.scheduling.annotation.Scheduled;

class OutboxSchedulerTest {
    @Test void observesCountAndDurationOnceAndKeepsDefaultDelay() throws Exception {
        try (var logs = new Capture(Level.DEBUG)) {
            var publisher = mock(OutboxPublisher.class);
            var now = Instant.parse("2026-11-19T00:00:00Z");
            when(publisher.publishPending(now)).thenReturn(2);
            long[] ticks = {0, 25_000_000};
            var index = new AtomicInteger();
            new OutboxScheduler(publisher, () -> now, () -> ticks[index.getAndIncrement()]).publishPending();
            verify(publisher, times(1)).publishPending(now);
            assertThat(logs.fields).containsExactly(Map.of("event", "outbox.poll.completed", "outcome", "SUCCEEDED",
                    "publishedCount", "2", "durationMs", "25.0"));
            assertThat(OutboxScheduler.class.getDeclaredMethod("publishPending").getAnnotation(Scheduled.class).fixedDelayString())
                    .isEqualTo("${bidflow.outbox.fixed-delay-ms:1000}");
            assertThat(MDC.getCopyOfContextMap()).isNullOrEmpty();
        }
    }

    @Test void emptyAndReversedTimerAreNotInventedDurations() {
        try (var logs = new Capture(Level.DEBUG)) {
            var publisher = mock(OutboxPublisher.class);
            long[] ticks = {10, 0};
            var index = new AtomicInteger();
            new OutboxScheduler(publisher, Instant::now, () -> ticks[index.getAndIncrement()]).publishPending();
            assertThat(logs.fields.getFirst()).containsEntry("publishedCount", "0").doesNotContainKey("durationMs");
        }
    }

    @Test void failureKeepsOriginalExceptionAndOmitsCountAndSecrets() {
        try (var logs = new Capture(Level.DEBUG)) {
            var publisher = mock(OutboxPublisher.class);
            var failure = new IllegalStateException("token-secret");
            when(publisher.publishPending(any())).thenThrow(failure);
            assertThatThrownBy(() -> new OutboxScheduler(publisher, Instant::now, () -> 0L).publishPending()).isSameAs(failure);
            assertThat(logs.fields.getFirst()).containsEntry("outcome", "FAILED").doesNotContainKey("publishedCount");
            assertThat(logs.messages.toString()).doesNotContain("token-secret");
            assertThat(MDC.getCopyOfContextMap()).isNullOrEmpty();
        }
    }

    @Test void infoSkipsExtraClockAndLogging() {
        try (var logs = new Capture(Level.INFO)) {
            var publisher = mock(OutboxPublisher.class);
            new OutboxScheduler(publisher, Instant::now, () -> { throw new AssertionError("ticker used"); }).publishPending();
            verify(publisher).publishPending(any());
            assertThat(logs.fields).isEmpty();
        }
    }

    @Test void brokenObservationDoesNotChangeSuccessOrOriginalFailure() {
        try (var logs = new Capture(Level.DEBUG)) {
            var publisher = mock(OutboxPublisher.class);
            var scheduler = new OutboxScheduler(publisher, Instant::now, () -> { throw new IllegalStateException("clock failed"); });
            assertThatCode(scheduler::publishPending).doesNotThrowAnyException();
            var failure = new IllegalStateException("original");
            when(publisher.publishPending(any())).thenThrow(failure);
            assertThatThrownBy(scheduler::publishPending).isSameAs(failure);
            assertThat(MDC.getCopyOfContextMap()).isNullOrEmpty();
        }
    }

    @Test void brokenLogSinkDoesNotChangePublicationOrLeakMdc() {
        try (var logs = new Capture(Level.DEBUG)) {
            var broken = new AppenderBase<ILoggingEvent>() {
                protected void append(ILoggingEvent event) { throw new IllegalStateException("sink unavailable"); }
            };
            broken.start(); logs.logger.addAppender(broken);
            try {
                var publisher = mock(OutboxPublisher.class);
                var scheduler = new OutboxScheduler(publisher, Instant::now, () -> 0L);
                assertThatCode(scheduler::publishPending).doesNotThrowAnyException();
                var failure = new IllegalStateException("original");
                when(publisher.publishPending(any())).thenThrow(failure);
                assertThatThrownBy(scheduler::publishPending).isSameAs(failure);
                assertThat(MDC.getCopyOfContextMap()).isNullOrEmpty();
            } finally { logs.logger.detachAppender(broken); broken.stop(); }
        }
    }

    private static class Capture extends AppenderBase<ILoggingEvent> implements AutoCloseable {
        final List<Map<String, String>> fields = new ArrayList<>();
        final List<String> messages = new ArrayList<>();
        final Logger logger = (Logger) LoggerFactory.getLogger(OutboxScheduler.class);
        final Level previous = logger.getLevel();
        Capture(Level level) { MDC.clear(); logger.setLevel(level); start(); logger.addAppender(this); }
        protected void append(ILoggingEvent event) { fields.add(Map.copyOf(event.getMDCPropertyMap())); messages.add(event.getFormattedMessage()); }
        public void close() { logger.detachAppender(this); logger.setLevel(previous); stop(); MDC.clear(); }
    }
}
