export type BidKind = "DIRECT" | "AUTO_MAX";
export type BidSettlement = Readonly<{ bidRequestId: string; decision: "ACCEPTED" | "REJECTED"; isHighestBidder: boolean; reason?: string | null }>;
export type BidRequestState = Readonly<{ kind: BidKind; amount: string; mode: "EDITING" | "INVALID" | "REVIEW" | "SUBMITTING" | "RECEIVED" | "SETTLED" | "ERROR"; bidRequestId?: string; settlement?: BidSettlement }>;
export type BidRequestEvent =
  | Readonly<{ type: "KIND_CHANGED"; kind: BidKind }>
  | Readonly<{ type: "AMOUNT_CHANGED"; amount: string }>
  | Readonly<{ type: "REVIEW_REQUESTED" }>
  | Readonly<{ type: "REVIEW_CANCELLED" }>
  | Readonly<{ type: "SUBMIT_REQUESTED"; retry?: boolean }>
  | Readonly<{ type: "RECEIVED"; bidRequestId: string }>
  | Readonly<{ type: "SETTLED"; settlement: BidSettlement }>
  | Readonly<{ type: "FAILED" }>;

export function createBidRequestState(): BidRequestState { return { kind: "DIRECT", amount: "", mode: "EDITING" }; }

export function parseBidAmount(raw: string): number | undefined {
  const amount = Number(raw);
  return /^\d+$/.test(raw) && Number.isSafeInteger(amount) && amount >= 1000 ? amount : undefined;
}

export function bidRequestReducer(state: BidRequestState, event: BidRequestEvent): BidRequestState {
  switch (event.type) {
    case "KIND_CHANGED": return { ...state, kind: event.kind, mode: "EDITING", bidRequestId: undefined, settlement: undefined };
    case "AMOUNT_CHANGED": return { ...state, amount: event.amount, mode: "EDITING", bidRequestId: undefined, settlement: undefined };
    case "REVIEW_REQUESTED": return parseBidAmount(state.amount) === undefined
      ? { ...state, mode: "INVALID" }
      : { ...state, mode: "REVIEW", bidRequestId: undefined, settlement: state.bidRequestId ? undefined : state.settlement };
    case "REVIEW_CANCELLED": return { ...state, mode: "EDITING" };
    case "SUBMIT_REQUESTED": return { ...state, mode: "SUBMITTING", bidRequestId: undefined, settlement: event.retry ? state.settlement : undefined };
    case "RECEIVED": return state.settlement?.bidRequestId === event.bidRequestId
      ? { ...state, mode: "SETTLED", bidRequestId: event.bidRequestId }
      : { ...state, mode: "RECEIVED", bidRequestId: event.bidRequestId, settlement: undefined };
    case "SETTLED": return state.bidRequestId !== undefined && state.bidRequestId !== event.settlement.bidRequestId
      ? state
      : { ...state, settlement: event.settlement, mode: state.bidRequestId === event.settlement.bidRequestId ? "SETTLED" : state.mode };
    case "FAILED": return { ...state, mode: "ERROR" };
  }
}
