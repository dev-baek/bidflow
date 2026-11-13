package com.bidflow.application.auction;

import java.util.UUID;

/** Removes a terminal auction from the short-lived Redis active-state projection. */
public interface AuctionActiveStateCleaner {
    void clear(UUID auctionId);
}
