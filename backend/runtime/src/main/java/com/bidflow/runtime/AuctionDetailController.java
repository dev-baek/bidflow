package com.bidflow.runtime;

import com.bidflow.application.auction.AuctionDetailSnapshot;
import com.bidflow.application.auction.AuctionDetailSnapshotReader;
import java.time.Instant;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/auctions")
class AuctionDetailController {
    private final AuctionDetailSnapshotReader snapshots;

    AuctionDetailController(AuctionDetailSnapshotReader snapshots) {
        this.snapshots = snapshots;
    }

    @GetMapping("/{auctionId}")
    ResponseEntity<?> get(@PathVariable UUID auctionId) {
        return snapshots.findByAuctionId(auctionId)
                .<ResponseEntity<?>>map(snapshot -> ResponseEntity.ok(Response.from(snapshot)))
                .orElseGet(() -> ResponseEntity.status(HttpStatus.NOT_FOUND).body(new Error("AUCTION_NOT_FOUND")));
    }

    record Response(UUID auctionId, String title, boolean hasThumbnail, long currentPrice, Instant endsAt,
            String status, long auctionVersion, String outcome, Long finalPrice) {
        static Response from(AuctionDetailSnapshot snapshot) {
            return new Response(snapshot.auctionId(), snapshot.title(), snapshot.hasThumbnail(),
                    snapshot.currentPrice(), snapshot.endsAt(), snapshot.status(), snapshot.auctionVersion(),
                    snapshot.outcome(), snapshot.finalPrice());
        }
    }

    record Error(String code) {
    }
}
