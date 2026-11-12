package com.bidflow.application.bid;

import java.time.Duration;
import java.util.Optional;
import java.util.UUID;

/** Port for the short-lived Redis projection used while an auction is active. */
public interface AuctionStateRepository {
    void save(AuctionRedisState state, Duration ttl);

    Optional<AuctionRedisState> findByAuctionId(UUID auctionId);

    void saveAutoMaximum(UUID auctionId, String bidderId, long maximum, Duration ttl);
}
