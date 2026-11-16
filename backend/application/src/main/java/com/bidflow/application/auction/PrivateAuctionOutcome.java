package com.bidflow.application.auction;

public enum PrivateAuctionOutcome {
    NOT_FINALIZED, NOT_APPLICABLE, NOT_PARTICIPATED, WON, LOST;

    public static PrivateAuctionOutcome classify(String status, String outcome, boolean acceptedBid, boolean winner) {
        return switch (status) {
            case "SCHEDULED", "ACTIVE" -> NOT_FINALIZED;
            case "CANCELLED" -> NOT_APPLICABLE;
            case "ENDED" -> {
                if ("UNSOLD".equals(outcome)) yield NOT_APPLICABLE;
                if (!"SOLD".equals(outcome)) throw new IllegalStateException("Ended auction has no final result");
                if (!acceptedBid) yield NOT_PARTICIPATED;
                yield winner ? WON : LOST;
            }
            default -> throw new IllegalStateException("Unknown auction state");
        };
    }
}
