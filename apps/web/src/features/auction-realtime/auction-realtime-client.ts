import { Client } from "@stomp/stompjs";

export type PublicAuctionMessage = Readonly<{ type: "auction.updated" | "auction.ended"; auctionId: string; auctionVersion: number }>;

export function parsePublicAuctionMessage(raw: string): PublicAuctionMessage | null {
  try {
    const value = JSON.parse(raw) as Partial<PublicAuctionMessage>;
    return (value.type === "auction.updated" || value.type === "auction.ended")
      && typeof value.auctionId === "string" && typeof value.auctionVersion === "number" ? value as PublicAuctionMessage : null;
  } catch { return null; }
}

export function subscribeAuctionUpdates(wsBaseUrl: string, auctionId: string, localActorId: string, onMessage: () => void): () => void {
  const client = new Client({
    brokerURL: `${wsBaseUrl}/ws`, reconnectDelay: 5_000,
    connectHeaders: { Authorization: `Bearer ${localActorId}` },
    onConnect: () => client.subscribe(`/topic/auctions/${auctionId}`, (frame) => { if (parsePublicAuctionMessage(frame.body)) onMessage(); }),
  });
  client.activate();
  return () => { void client.deactivate(); };
}
