import { describe, expect, it } from "vitest";
import { parseBidResultMessage, parsePublicAuctionMessage } from "./auction-realtime-client";

describe("parsePublicAuctionMessage", () => {
  it("accepts only public auction update and end payloads", () => {
    expect(parsePublicAuctionMessage('{"type":"auction.updated","auctionId":"auction-1","auctionVersion":2}'))
      .toEqual({ type: "auction.updated", auctionId: "auction-1", auctionVersion: 2 });
    expect(parsePublicAuctionMessage('{"type":"bid.result","auctionId":"auction-1","auctionVersion":2}')).toBeNull();
  });

  it("accepts only a complete private bid result payload", () => {
    expect(parseBidResultMessage('{"type":"bid.result","bidRequestId":"request-1","auctionId":"auction-1","auctionVersion":2,"decision":"ACCEPTED","reason":null,"currentPrice":21000,"endsAt":"2030-01-01T12:00:00Z","isHighestBidder":false}'))
      .toMatchObject({ bidRequestId: "request-1", decision: "ACCEPTED", isHighestBidder: false });
    expect(parseBidResultMessage('{"type":"bid.result","bidRequestId":"request-1"}')).toBeNull();
    expect(parseBidResultMessage('{"type":"bid.result","bidRequestId":"request-1","auctionId":"auction-1","auctionVersion":2,"decision":"ACCEPTED","reason":1,"currentPrice":21000,"endsAt":"2030-01-01T12:00:00Z","isHighestBidder":false}')).toBeNull();
  });
});
