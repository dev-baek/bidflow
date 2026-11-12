package com.bidflow.domain.bid;

public final class AutoBidRules {
    private AutoBidRules() {
    }

    public static AutoBidResult resolve(String existingWinnerId, long existingMaximum, String challengerId, long challengerMaximum) {
        if (existingMaximum >= challengerMaximum) {
            return new AutoBidResult(existingWinnerId, challengerMaximum);
        }
        return new AutoBidResult(challengerId, Math.min(challengerMaximum, BidPriceRules.minimumNextPrice(existingMaximum)));
    }
}
