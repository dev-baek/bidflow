package com.bidflow.application.bid;

import java.util.Optional;
import java.util.UUID;

/** Reads the durable source required for one-auction Redis recovery. */
public interface AuctionRecoverySnapshotRepository {
    Optional<AuctionRecoverySnapshot> findByAuctionId(UUID auctionId);
}
