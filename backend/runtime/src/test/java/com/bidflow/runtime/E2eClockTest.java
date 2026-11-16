package com.bidflow.runtime;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import org.junit.jupiter.api.Test;

class E2eClockTest {
    @Test
    void changesOnlyTheInjectedServerClock() {
        E2eClock clock = new E2eClock(Instant.parse("2030-01-01T12:00:00Z"));

        new E2eClockController(clock).set(new E2eClockController.Request(Instant.parse("2030-01-01T12:10:01Z")));

        assertThat(clock.instant()).isEqualTo(Instant.parse("2030-01-01T12:10:01Z"));
    }
}
