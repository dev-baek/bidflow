import { describe, expect, it } from "vitest";
import { auctionDetailReducer, createAuctionDetailState, type AuctionDetail } from "./auction-detail-state";

const detail: AuctionDetail = {
  auctionId: "auction-1", title: "카메라", hasThumbnail: false, currentPrice: 21_000,
  endsAt: "2030-01-01T12:00:00Z", status: "ACTIVE", auctionVersion: 2, outcome: null, finalPrice: null,
};

describe("auctionDetailReducer", () => {
  it("transitions from loading to the authoritative REST snapshot", () => {
    expect(auctionDetailReducer(createAuctionDetailState(), { type: "SNAPSHOT_LOADED", detail }))
      .toEqual({ mode: "READY", detail });
  });

  it("distinguishes missing auctions from transient loading failures", () => {
    expect(auctionDetailReducer(createAuctionDetailState(), { type: "NOT_FOUND" })).toEqual({ mode: "NOT_FOUND" });
    expect(auctionDetailReducer(createAuctionDetailState(), { type: "LOAD_FAILED" })).toEqual({ mode: "ERROR" });
  });

  it("keeps the current snapshot when a delayed response has an older version or same-version shorter deadline", () => {
    const ready = { mode: "READY", detail } as const;
    for (const stale of [
      { ...detail, auctionVersion: 1, currentPrice: 10_000 },
      { ...detail, endsAt: "2030-01-01T11:55:00Z" },
    ]) {
      expect(auctionDetailReducer(ready, { type: "SNAPSHOT_LOADED", detail: stale })).toBe(ready);
    }
    const ended = { ...detail, status: "ENDED", outcome: "SOLD", finalPrice: 21_000 } as const;
    const closed = auctionDetailReducer(ready, { type: "SNAPSHOT_LOADED", detail: ended });
    expect(closed).toEqual({ mode: "READY", detail: ended });
    expect(auctionDetailReducer(closed, { type: "SNAPSHOT_LOADED", detail })).toBe(closed);
  });

  it("keeps the last snapshot on a transient refresh failure and clears the warning on recovery", () => {
    const failed = auctionDetailReducer({ mode: "READY", detail }, { type: "LOAD_FAILED" });
    expect(failed).toEqual({ mode: "READY", detail, refreshFailed: true });
    expect(auctionDetailReducer(failed, { type: "SNAPSHOT_LOADED", detail })).toEqual({ mode: "READY", detail });
  });
});
