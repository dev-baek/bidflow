import { describe, expect, it } from "vitest";
import { applyAuctionRealtimeEvent, type AuctionRealtimeState } from "./auction-realtime-state";

const initial: AuctionRealtimeState = {
  auctionId: "auction-1", endsAt: "2030-01-01T12:04:00Z", version: 1, status: "ACTIVE",
};

describe("applyAuctionRealtimeEvent", () => {
  it("shows the extended end time after accepted and extension events share an auction version", () => {
    const accepted = applyAuctionRealtimeEvent(initial, {
      type: "BidAccepted", eventId: "event-1", auctionId: "auction-1", auctionVersion: 2, endsAt: "2030-01-01T12:09:00Z",
    });
    const extended = applyAuctionRealtimeEvent(accepted, {
      type: "AuctionExtended", eventId: "event-2", auctionId: "auction-1", auctionVersion: 2, extendedEndsAt: "2030-01-01T12:09:00Z",
    });

    expect(extended).toMatchObject({ endsAt: "2030-01-01T12:09:00Z", version: 2, status: "ACTIVE" });
  });

  it("does not move the displayed end time backwards for an older or delayed same-version event", () => {
    const current = { ...initial, endsAt: "2030-01-01T12:09:00Z", version: 2 };

    expect(applyAuctionRealtimeEvent(current, {
      type: "AuctionExtended", eventId: "event-old", auctionId: "auction-1", auctionVersion: 1, extendedEndsAt: "2030-01-01T12:04:00Z",
    })).toBe(current);
    expect(applyAuctionRealtimeEvent(current, {
      type: "BidAccepted", eventId: "event-delayed", auctionId: "auction-1", auctionVersion: 2, endsAt: "2030-01-01T12:04:00Z",
    })).toBe(current);
  });
});
