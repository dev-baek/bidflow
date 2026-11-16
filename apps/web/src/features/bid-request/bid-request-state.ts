export type BidKind = "DIRECT" | "AUTO_MAX";
export type BidSettlement = Readonly<{ bidRequestId: string; decision: "ACCEPTED" | "REJECTED"; isHighestBidder: boolean }>;
export type BidRequestState = Readonly<{ kind: BidKind; amount: string; mode: "EDITING" | "SUBMITTING" | "RECEIVED" | "SETTLED" | "ERROR"; bidRequestId?: string; settlement?: BidSettlement }>;
export type BidRequestEvent =
  | Readonly<{ type: "KIND_CHANGED"; kind: BidKind }>
  | Readonly<{ type: "AMOUNT_CHANGED"; amount: string }>
  | Readonly<{ type: "SUBMIT_REQUESTED" }>
  | Readonly<{ type: "RECEIVED"; bidRequestId: string }>
  | Readonly<{ type: "SETTLED"; settlement: BidSettlement }>
  | Readonly<{ type: "FAILED" }>;

export function createBidRequestState(): BidRequestState { return { kind: "DIRECT", amount: "", mode: "EDITING" }; }
export function bidRequestReducer(state: BidRequestState, event: BidRequestEvent): BidRequestState {
  switch (event.type) {
    case "KIND_CHANGED": return { ...state, kind: event.kind, mode: "EDITING", bidRequestId: undefined, settlement: undefined };
    case "AMOUNT_CHANGED": return { ...state, amount: event.amount, mode: "EDITING", bidRequestId: undefined, settlement: undefined };
    case "SUBMIT_REQUESTED": return { ...state, mode: "SUBMITTING", settlement: undefined };
    case "RECEIVED": return state.settlement?.bidRequestId === event.bidRequestId
      ? { ...state, mode: "SETTLED", bidRequestId: event.bidRequestId }
      : { ...state, mode: "RECEIVED", bidRequestId: event.bidRequestId };
    case "SETTLED": return state.bidRequestId !== undefined && state.bidRequestId !== event.settlement.bidRequestId
      ? state
      : { ...state, settlement: event.settlement, mode: state.bidRequestId === event.settlement.bidRequestId ? "SETTLED" : state.mode };
    case "FAILED": return { ...state, mode: "ERROR" };
  }
}
