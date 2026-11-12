package com.bidflow.application.realtime;

import java.util.Optional;
import java.util.UUID;

public interface AuctionRealtimeSnapshotReader {
    Optional<AuctionRealtimeSnapshot> findByAuctionId(UUID auctionId);
}
