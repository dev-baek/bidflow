import type { StompConfig } from "@stomp/stompjs";
import { describe, expect, it, vi } from "vitest";
import { parseBidResultMessage, parsePublicAuctionMessage, subscribeAuctionUpdates } from "./auction-realtime-client";

const { clients } = vi.hoisted(() => ({ clients: vi.fn() }));
vi.mock("@stomp/stompjs", () => ({
  Client: class {
    activate = vi.fn();
    deactivate = vi.fn(async () => {});
    subscribe = vi.fn();
    connectHeaders: StompConfig["connectHeaders"];
    constructor(config: StompConfig) {
      this.connectHeaders = config.connectHeaders;
      clients(this, config);
    }
  },
}));

it("checks Cognito credentials before every connection and refuses to reconnect after expiry", async () => {
  clients.mockClear();
  let token: string | undefined = "first";
  subscribeAuctionUpdates("wss://api.example.test", "auction-1", () => token, vi.fn(), vi.fn());
  const [client, config] = clients.mock.calls[0]!;
  await config.beforeConnect(client);
  expect(client.connectHeaders).toEqual({ Authorization: "Bearer first" });
  token = "second";
  await config.beforeConnect(client);
  expect(client.connectHeaders).toEqual({ Authorization: "Bearer second" });
  token = undefined;
  await config.beforeConnect(client);
  expect(client.connectHeaders).toEqual({});
  expect(client.deactivate).toHaveBeenCalledOnce();
  config.onConnect();
  expect(client.subscribe).not.toHaveBeenCalled();
});

it("does not activate Cognito STOMP on insecure brokers", () => {
  clients.mockClear();
  subscribeAuctionUpdates("ws://api.example.test", "auction-1", () => "token", vi.fn(), vi.fn());
  expect(clients).not.toHaveBeenCalled();
});

it("preserves the local STOMP header and ignores frames after disconnect", async () => {
  clients.mockClear();
  const refresh = vi.fn(), privateResult = vi.fn();
  const stop = subscribeAuctionUpdates("ws://localhost:8080", "auction-1", "local-user", refresh, privateResult);
  const [client, config] = clients.mock.calls[0]!;
  await config.beforeConnect(client);
  expect(client.connectHeaders).toEqual({ Authorization: "Bearer local-user" });
  config.onConnect();
  const [, receive] = client.subscribe.mock.calls[1];
  const frame = { body: '{"type":"bid.result","bidRequestId":"request-1","auctionId":"auction-1","auctionVersion":2,"decision":"ACCEPTED","reason":null,"currentPrice":21000,"endsAt":"2030-01-01T12:00:00Z","isHighestBidder":false}' };
  receive(frame);
  stop();
  receive(frame);
  expect(privateResult).toHaveBeenCalledOnce();
});

it("signals socket loss and clears it after reconnect while refreshing the snapshot", async () => {
  clients.mockClear();
  const refresh = vi.fn(), reconnecting = vi.fn();
  const stop = subscribeAuctionUpdates("ws://localhost:8080", "auction-1", "local-user", refresh, vi.fn(), reconnecting);
  const [, config] = clients.mock.calls[0]!;
  config.onConnect();
  config.onWebSocketClose();
  config.onConnect();
  expect(reconnecting.mock.calls).toEqual([[false], [true], [false]]);
  expect(refresh).toHaveBeenCalledOnce();
  stop();
  config.onWebSocketClose();
  expect(reconnecting).toHaveBeenCalledTimes(3);
});

describe("parsePublicAuctionMessage", () => {
  it("accepts only public auction update and end payloads", () => {
    expect(parsePublicAuctionMessage('{"type":"auction.updated","auctionId":"auction-1","auctionVersion":2}'))
      .toEqual({ type: "auction.updated", auctionId: "auction-1", auctionVersion: 2 });
    expect(parsePublicAuctionMessage('{"type":"bid.result","auctionId":"auction-1","auctionVersion":2}')).toBeNull();
  });

  it("accepts only a complete private bid result payload", () => {
    expect(parseBidResultMessage('{"type":"bid.result","bidRequestId":"request-1","auctionId":"auction-1","auctionVersion":2,"decision":"ACCEPTED","reason":null,"currentPrice":21000,"endsAt":"2030-01-01T12:00:00Z","isHighestBidder":false}'))
      .toMatchObject({ bidRequestId: "request-1", decision: "ACCEPTED", isHighestBidder: false });
    expect(parseBidResultMessage('{"type":"bid.result","bidRequestId":"request-1"}')).toBeNull();
    expect(parseBidResultMessage('{"type":"bid.result","bidRequestId":"request-1","auctionId":"auction-1","auctionVersion":2,"decision":"ACCEPTED","reason":1,"currentPrice":21000,"endsAt":"2030-01-01T12:00:00Z","isHighestBidder":false}')).toBeNull();
  });
});
