package com.bidflow.runtime;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Objects;
import java.util.concurrent.atomic.AtomicReference;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Profile;

@Configuration
@Profile("e2e")
class E2eClockConfiguration {
    @Bean
    E2eClock e2eClock() {
        return new E2eClock(Instant.parse("2030-01-01T12:00:00Z"));
    }

    @Bean
    Clock clock(E2eClock clock) {
        return clock;
    }
}

final class E2eClock extends Clock {
    private final AtomicReference<Instant> instant;

    E2eClock(Instant initial) {
        instant = new AtomicReference<>(Objects.requireNonNull(initial, "initial must not be null"));
    }

    void set(Instant next) {
        instant.set(Objects.requireNonNull(next, "next must not be null"));
    }

    @Override public ZoneOffset getZone() { return ZoneOffset.UTC; }
    @Override public Clock withZone(java.time.ZoneId zone) { return this; }
    @Override public Instant instant() { return instant.get(); }
}
