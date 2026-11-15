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
});
