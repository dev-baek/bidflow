export type AuctionRealtimeState = Readonly<{ auctionId: string; endsAt: string; version: number; status: "ACTIVE" | "ENDED" }>;

export type AuctionRealtimeEvent =
  | Readonly<{ type: "BidAccepted"; eventId: string; auctionId: string; auctionVersion: number; endsAt: string }>
  | Readonly<{ type: "AuctionExtended"; eventId: string; auctionId: string; auctionVersion: number; extendedEndsAt: string }>
  | Readonly<{ type: "AuctionEnded"; eventId: string; auctionId: string; auctionVersion: number }>;

/** Pure reducer for out-of-order WebSocket events; PostgreSQL snapshots remain the final authority. */
export function applyAuctionRealtimeEvent(state: AuctionRealtimeState, event: AuctionRealtimeEvent): AuctionRealtimeState {
  if (state.auctionId !== event.auctionId || event.auctionVersion < state.version) return state;
  if (event.type === "AuctionEnded") return { ...state, version: event.auctionVersion, status: "ENDED" };
  const endsAt = event.type === "AuctionExtended" ? event.extendedEndsAt : event.endsAt;
  if (event.auctionVersion === state.version && endsAt < state.endsAt) return state;
  return { ...state, endsAt, version: event.auctionVersion };
}
