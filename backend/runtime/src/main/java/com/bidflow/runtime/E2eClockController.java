package com.bidflow.runtime;

import java.time.Instant;
import org.springframework.context.annotation.Profile;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@Profile("e2e")
@RequestMapping("/api/internal/e2e/clock")
class E2eClockController {
    private final E2eClock clock;

    E2eClockController(E2eClock clock) {
        this.clock = clock;
    }

    @PostMapping
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void set(@RequestBody Request request) {
        clock.set(request.instant());
    }

    record Request(Instant instant) { }
}
