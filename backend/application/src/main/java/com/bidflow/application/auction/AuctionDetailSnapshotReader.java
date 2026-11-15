package com.bidflow.application.auction;

import java.util.Optional;
import java.util.UUID;

public interface AuctionDetailSnapshotReader {
    Optional<AuctionDetailSnapshot> findByAuctionId(UUID auctionId);
}
