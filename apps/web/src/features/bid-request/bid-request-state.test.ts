import { describe, expect, it } from "vitest";
import { bidRequestReducer, createBidRequestState } from "./bid-request-state";

describe("bidRequestReducer", () => {
  it("keeps the current price untouched while a request is only received", () => {
    const submitting = bidRequestReducer({ ...createBidRequestState(), amount: "21000" }, { type: "SUBMIT_REQUESTED" });
    expect(bidRequestReducer(submitting, { type: "RECEIVED", bidRequestId: "request-1" }))
      .toEqual({ kind: "DIRECT", amount: "21000", mode: "RECEIVED", bidRequestId: "request-1" });
  });

  it("returns to editing when the amount changes after a failure", () => {
    expect(bidRequestReducer({ ...createBidRequestState(), mode: "ERROR" }, { type: "AMOUNT_CHANGED", amount: "30000" }))
      .toMatchObject({ amount: "30000", mode: "EDITING" });
  });

  it("matches a private settlement to its received request even when the result arrives first", () => {
    const submitting = bidRequestReducer({ ...createBidRequestState(), amount: "30000" }, { type: "SUBMIT_REQUESTED" });
    const resultFirst = bidRequestReducer(submitting, {
      type: "SETTLED",
      settlement: { bidRequestId: "request-1", decision: "ACCEPTED", isHighestBidder: true },
    });
    const settled = bidRequestReducer(resultFirst, { type: "RECEIVED", bidRequestId: "request-1" });

    expect(settled).toMatchObject({ mode: "SETTLED", bidRequestId: "request-1", settlement: { isHighestBidder: true } });
    expect(bidRequestReducer(settled, {
      type: "SETTLED",
      settlement: { bidRequestId: "other-request", decision: "ACCEPTED", isHighestBidder: false },
    })).toEqual(settled);
  });
});
