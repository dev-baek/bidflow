package com.bidflow.application.bid;
import java.util.UUID;
public record BidRequestCommand(UUID auctionId, String bidKind, long amount) {}
