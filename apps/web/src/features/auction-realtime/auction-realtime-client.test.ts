import { describe, expect, it } from "vitest";
import { parsePublicAuctionMessage } from "./auction-realtime-client";

describe("parsePublicAuctionMessage", () => {
  it("accepts only public auction update and end payloads", () => {
    expect(parsePublicAuctionMessage('{"type":"auction.updated","auctionId":"auction-1","auctionVersion":2}'))
      .toEqual({ type: "auction.updated", auctionId: "auction-1", auctionVersion: 2 });
    expect(parsePublicAuctionMessage('{"type":"bid.result","auctionId":"auction-1","auctionVersion":2}')).toBeNull();
  });
});
