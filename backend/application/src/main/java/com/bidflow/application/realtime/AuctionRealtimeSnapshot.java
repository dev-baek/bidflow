package com.bidflow.application.realtime;

import java.time.Instant;
import java.util.UUID;

/** Public fields of the PostgreSQL auction snapshot used to repair realtime delivery. */
public record AuctionRealtimeSnapshot(UUID auctionId, long currentPrice, Instant endsAt, String status, long auctionVersion) {
}
