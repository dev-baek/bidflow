package com.bidflow.application.bid;
public final class BidRequestValidation {
    private BidRequestValidation() {}
    public static BidKind validate(BidRequestCommand command) {
        if (command.auctionId() == null || command.amount() < 1_000L) throw new IllegalArgumentException("invalid bid request");
        try { return BidKind.valueOf(command.bidKind()); }
        catch (Exception exception) { throw new IllegalArgumentException("invalid bid kind", exception); }
    }
}
