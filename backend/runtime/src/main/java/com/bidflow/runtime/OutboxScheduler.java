package com.bidflow.runtime;

import com.bidflow.application.outbox.OutboxPublisher;
import com.bidflow.application.outbox.OutboxPublication;
import java.util.LinkedHashMap;
import java.util.function.LongSupplier;
import java.util.function.Supplier;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import java.time.Instant;

@Component
class OutboxScheduler {
    private static final Logger LOG = LoggerFactory.getLogger(OutboxScheduler.class);
    private final OutboxPublisher publisher;
    private final Supplier<Instant> clock;
    private final LongSupplier ticker;
    @Autowired
    OutboxScheduler(OutboxPublisher publisher) { this(publisher, Instant::now, System::nanoTime); }
    OutboxScheduler(OutboxPublisher publisher, Supplier<Instant> clock, LongSupplier ticker) {
        this.publisher = publisher; this.clock = clock; this.ticker = ticker;
    }
    @Scheduled(fixedDelayString = "${bidflow.outbox.fixed-delay-ms:1000}")
    void publishPending() {
        if (!LOG.isDebugEnabled()) { publisher.publishPending(clock.get()); return; }
        Long start = tick();
        Integer count = null;
        try { count = publisher.publishPending(clock.get()); }
        finally { observe(start, count); }
    }

    private Long tick() {
        try { return ticker.getAsLong(); }
        catch (RuntimeException ignored) { return null; }
    }

    private void observe(Long start, Integer count) {
        try {
            Long end = tick();
            Double duration = start == null || end == null ? null : OutboxPublication.elapsedMillis(start, end);
            var fields = new LinkedHashMap<String, String>();
            fields.put("event", "outbox.poll.completed");
            fields.put("outcome", count == null ? "FAILED" : "SUCCEEDED");
            if (count != null) fields.put("publishedCount", count.toString());
            if (duration != null) fields.put("durationMs", duration.toString());
            try (var scope = LogContext.fields(fields)) { LOG.debug("outbox poll"); }
        } catch (RuntimeException ignored) { /* Observation must not change publication or its original failure. */ }
    }
}
