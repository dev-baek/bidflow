package com.bidflow.application.bid;
import java.util.UUID;
public record BidCommandMessage(UUID bidRequestId, UUID auctionId, String bidderId, BidKind bidKind, long amount) {
 public static BidCommandMessage from(UUID requestId, UUID auctionId, String bidderId, BidKind kind, long amount){return new BidCommandMessage(requestId,auctionId,bidderId,kind,amount);}
 public String kafkaKey(){return auctionId.toString();}
 public String eventType(){return "BidCommandRequested";}
}
