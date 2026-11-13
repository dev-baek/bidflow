package com.bidflow.application.auction;

import java.time.Instant;

/** Atomically finalizes expired auctions from the durable PostgreSQL state. */
public interface AuctionCloseRepository {
    int closeExpired(Instant now, int batchSize);
}
