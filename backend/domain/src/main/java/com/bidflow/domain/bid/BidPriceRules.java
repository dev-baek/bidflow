package com.bidflow.domain.bid;

public final class BidPriceRules {
    private BidPriceRules() {
    }

    public static long incrementFor(long currentPrice) {
        if (currentPrice < 1_000L) {
            throw new IllegalArgumentException("currentPrice must be at least 1000");
        }
        if (currentPrice < 100_000L) return 1_000L;
        if (currentPrice < 500_000L) return 5_000L;
        if (currentPrice < 1_000_000L) return 10_000L;
        return 50_000L;
    }

    public static long minimumNextPrice(long currentPrice) {
        return Math.addExact(currentPrice, incrementFor(currentPrice));
    }
}
