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
  localActorId: string,
  onPublicMessage: () => void,
  onBidResult: (result: BidResultMessage) => void,
): () => void {
  const client = new Client({
    brokerURL: `${wsBaseUrl}/ws`, reconnectDelay: 5_000,
    connectHeaders: { Authorization: `Bearer ${localActorId}` },
    onConnect: () => {
      client.subscribe(`/topic/auctions/${auctionId}`, (frame) => { if (parsePublicAuctionMessage(frame.body)) onPublicMessage(); });
      client.subscribe("/user/queue/bid-results", (frame) => {
        const result = parseBidResultMessage(frame.body);
        if (result?.auctionId === auctionId) onBidResult(result);
      });
    },
  });
  client.activate();
  return () => { void client.deactivate(); };
}
