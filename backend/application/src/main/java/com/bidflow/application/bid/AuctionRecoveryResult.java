package com.bidflow.application.bid;

/** Result of attempting to rebuild the Redis projection for one auction. */
public record AuctionRecoveryResult(AuctionRecoverySnapshot snapshot, boolean restored) {
    public boolean ended() {
        return !restored;
    }
}
