import { Client } from "@stomp/stompjs";

export type PublicAuctionMessage = Readonly<{ type: "auction.updated" | "auction.ended"; auctionId: string; auctionVersion: number }>;
export type BidResultMessage = Readonly<{
  type: "bid.result";
  bidRequestId: string;
  auctionId: string;
  auctionVersion: number;
  decision: "ACCEPTED" | "REJECTED";
  reason: string | null;
  currentPrice: number;
  endsAt: string;
  isHighestBidder: boolean;
}>;

export function parsePublicAuctionMessage(raw: string): PublicAuctionMessage | null {
  try {
    const value = JSON.parse(raw) as Partial<PublicAuctionMessage>;
    return (value.type === "auction.updated" || value.type === "auction.ended")
      && typeof value.auctionId === "string" && typeof value.auctionVersion === "number" ? value as PublicAuctionMessage : null;
  } catch { return null; }
}

export function parseBidResultMessage(raw: string): BidResultMessage | null {
  try {
    const value = JSON.parse(raw) as Partial<BidResultMessage>;
    return value.type === "bid.result" && typeof value.bidRequestId === "string" && typeof value.auctionId === "string"
      && typeof value.auctionVersion === "number" && (value.decision === "ACCEPTED" || value.decision === "REJECTED")
      && (typeof value.reason === "string" || value.reason === null) && typeof value.currentPrice === "number"
      && typeof value.endsAt === "string" && typeof value.isHighestBidder === "boolean"
      ? value as BidResultMessage : null;
  } catch { return null; }
}

export function subscribeAuctionUpdates(
  wsBaseUrl: string,
  auctionId: string,
  credential: string | (() => string | undefined),
  refreshSnapshot: () => void,
  onBidResult: (result: BidResultMessage) => void,
): () => void {
  const brokerURL = `${wsBaseUrl.replace(/\/$/, "")}/ws`;
  if (typeof credential === "function") {
    const broker = URL.parse(wsBaseUrl);
    if (!broker || broker.protocol !== "wss:" || broker.username || broker.password || broker.search || broker.hash) return () => {};
  }
  const getToken = typeof credential === "string" ? () => credential : credential;
  let stopped = false;
  let connectedBefore = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    client.connectHeaders = {};
    void client.deactivate();
  };
  const client = new Client({
    brokerURL, reconnectDelay: 5_000,
    beforeConnect: () => {
      const token = stopped ? undefined : getToken();
      if (!token) return stop();
      client.connectHeaders = { Authorization: `Bearer ${token}` };
    },
    onConnect: () => {
      if (stopped) return;
      if (!getToken()) return stop();
      client.subscribe(`/topic/auctions/${auctionId}`, (frame) => {
        if (!stopped && getToken() && parsePublicAuctionMessage(frame.body)?.auctionId === auctionId) refreshSnapshot();
      });
      client.subscribe("/user/queue/bid-results", (frame) => {
        if (stopped || !getToken()) return;
        const result = parseBidResultMessage(frame.body);
        if (result?.auctionId === auctionId) onBidResult(result);
      });
      // shortcut: Spring's simple broker has no SUBSCRIBE receipt; revisit if broker-confirmed recovery is required.
      if (connectedBefore) refreshSnapshot();
      connectedBefore = true;
    },
  });
  client.activate();
  return stop;
}
