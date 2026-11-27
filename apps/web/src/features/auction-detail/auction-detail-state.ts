export type AuctionDetail = Readonly<{
  auctionId: string;
  title: string;
  hasThumbnail?: boolean;
  currentPrice: number;
  endsAt: string;
  status: "SCHEDULED" | "ACTIVE" | "ENDED" | "CANCELLED";
  auctionVersion: number;
  outcome: "SOLD" | "UNSOLD" | null;
  finalPrice: number | null;
}>;

export type AuctionDetailState =
  | Readonly<{ mode: "LOADING" }>
  | Readonly<{ mode: "READY"; detail: AuctionDetail; refreshFailed?: true }>
  | Readonly<{ mode: "NOT_FOUND" }>
  | Readonly<{ mode: "ERROR" }>;

export type AuctionDetailEvent =
  | Readonly<{ type: "SNAPSHOT_LOADED"; detail: AuctionDetail }>
  | Readonly<{ type: "NOT_FOUND" }>
  | Readonly<{ type: "LOAD_FAILED" }>;

export function createAuctionDetailState(): AuctionDetailState {
  return { mode: "LOADING" };
}

export function auctionDetailReducer(state: AuctionDetailState, event: AuctionDetailEvent): AuctionDetailState {
  switch (event.type) {
    case "SNAPSHOT_LOADED": {
      const next = event.detail;
      if (state.mode === "READY" && state.detail.auctionId === next.auctionId) {
        const current = state.detail;
        if (next.auctionVersion < current.auctionVersion) return state;
        const terminal = current.status === "ENDED" || current.status === "CANCELLED";
        if (next.auctionVersion === current.auctionVersion
          && (Date.parse(next.endsAt) < Date.parse(current.endsAt) || (terminal && next.status !== current.status))) return state;
      }
      return { mode: "READY", detail: next };
    }
    case "NOT_FOUND": return { mode: "NOT_FOUND" };
    case "LOAD_FAILED": return state.mode === "READY" ? { ...state, refreshFailed: true } : { mode: "ERROR" };
  }
}
