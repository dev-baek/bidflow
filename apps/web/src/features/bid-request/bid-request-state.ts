export type BidKind = "DIRECT" | "AUTO_MAX";
export type BidRequestState = Readonly<{ kind: BidKind; amount: string; mode: "EDITING" | "SUBMITTING" | "RECEIVED" | "ERROR"; bidRequestId?: string }>;
export type BidRequestEvent =
  | Readonly<{ type: "KIND_CHANGED"; kind: BidKind }>
  | Readonly<{ type: "AMOUNT_CHANGED"; amount: string }>
  | Readonly<{ type: "SUBMIT_REQUESTED" }>
  | Readonly<{ type: "RECEIVED"; bidRequestId: string }>
  | Readonly<{ type: "FAILED" }>;

export function createBidRequestState(): BidRequestState { return { kind: "DIRECT", amount: "", mode: "EDITING" }; }
export function bidRequestReducer(state: BidRequestState, event: BidRequestEvent): BidRequestState {
  switch (event.type) {
    case "KIND_CHANGED": return { ...state, kind: event.kind, mode: "EDITING", bidRequestId: undefined };
    case "AMOUNT_CHANGED": return { ...state, amount: event.amount, mode: "EDITING", bidRequestId: undefined };
    case "SUBMIT_REQUESTED": return { ...state, mode: "SUBMITTING" };
    case "RECEIVED": return { ...state, mode: "RECEIVED", bidRequestId: event.bidRequestId };
    case "FAILED": return { ...state, mode: "ERROR" };
  }
}
