package com.bidflow.runtime;

import com.bidflow.application.auction.AuctionCloseRepository;
import java.time.Clock;
import java.time.Instant;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
class AuctionCloseScheduler {
    private final AuctionCloseRepository repository;
    private final Clock clock;

    AuctionCloseScheduler(AuctionCloseRepository repository, Clock clock) {
        this.repository = repository;
        this.clock = clock;
    }

    @Scheduled(fixedDelayString = "${bidflow.auction-close.fixed-delay-ms:1000}")
    void closeExpired() {
        repository.closeExpired(Instant.now(clock), 100);
    }
}
