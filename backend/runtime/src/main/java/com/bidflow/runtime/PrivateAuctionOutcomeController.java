package com.bidflow.runtime;

import com.bidflow.application.auction.PrivateAuctionOutcome;
import com.bidflow.application.auction.PrivateAuctionOutcomeReader;
import java.security.Principal;
import java.util.UUID;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;

@RestController
class PrivateAuctionOutcomeController {
    private final PrivateAuctionOutcomeReader outcomes;

    PrivateAuctionOutcomeController(PrivateAuctionOutcomeReader outcomes) {
        this.outcomes = outcomes;
    }

    @GetMapping("/api/v1/me/auctions/{auctionId}/outcome")
    ResponseEntity<?> get(@PathVariable UUID auctionId, Principal viewer) {
        CacheControl cache = CacheControl.noStore();
        return outcomes.findForViewer(auctionId, viewer.getName())
                .<ResponseEntity<?>>map(outcome -> ResponseEntity.ok().cacheControl(cache).body(new Response(auctionId, outcome)))
                .orElseGet(() -> ResponseEntity.status(HttpStatus.NOT_FOUND).cacheControl(cache).body(new Error("AUCTION_NOT_FOUND")));
    }

    record Response(UUID auctionId, PrivateAuctionOutcome outcome) {}
    record Error(String code) {}
}
