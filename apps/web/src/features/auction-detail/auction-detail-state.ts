export type AuctionDetail = Readonly<{
  auctionId: string;
  title: string;
  thumbnailObjectKey: string | null;
  currentPrice: number;
  endsAt: string;
  status: "SCHEDULED" | "ACTIVE" | "ENDED" | "CANCELLED";
  auctionVersion: number;
  outcome: "SOLD" | "UNSOLD" | null;
  finalPrice: number | null;
}>;

export type AuctionDetailState =
  | Readonly<{ mode: "LOADING" }>
  | Readonly<{ mode: "READY"; detail: AuctionDetail }>
  | Readonly<{ mode: "NOT_FOUND" }>
  | Readonly<{ mode: "ERROR" }>;

export type AuctionDetailEvent =
  | Readonly<{ type: "SNAPSHOT_LOADED"; detail: AuctionDetail }>
  | Readonly<{ type: "NOT_FOUND" }>
  | Readonly<{ type: "LOAD_FAILED" }>;

export function createAuctionDetailState(): AuctionDetailState {
  return { mode: "LOADING" };
}

export function auctionDetailReducer(_: AuctionDetailState, event: AuctionDetailEvent): AuctionDetailState {
  switch (event.type) {
    case "SNAPSHOT_LOADED": return { mode: "READY", detail: event.detail };
    case "NOT_FOUND": return { mode: "NOT_FOUND" };
    case "LOAD_FAILED": return { mode: "ERROR" };
  }
}
