package com.bidflow.application.outbox;

public record OutboxPublication(OutboxEvent event, Outcome outcome, Double batchWaitMs) {
    public enum Outcome { PUBLISHED, PUBLISH_FAILED, MARK_FAILED }

    public static Double elapsedMillis(long start, long end) {
        long elapsed = end - start;
        return elapsed < 0 ? null : elapsed / 1_000_000.0;
    }
}
