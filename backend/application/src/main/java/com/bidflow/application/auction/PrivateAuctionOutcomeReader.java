package com.bidflow.application.auction;

import java.util.Optional;
import java.util.UUID;

public interface PrivateAuctionOutcomeReader {
    Optional<PrivateAuctionOutcome> findForViewer(UUID auctionId, String viewerId);
}
