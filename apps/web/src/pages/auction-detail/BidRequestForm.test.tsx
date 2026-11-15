import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ApiClient } from "../../shared/api/api-client";
import { BidRequestForm } from "./BidRequestForm";

describe("BidRequestForm", () => {
  it("sends an asynchronous direct bid request and shows only its receipt", async () => {
    let receivedRequest: readonly unknown[] = [];
    const post: ApiClient["post"] = async <T,>(path: string, body: unknown, headers?: Record<string, string>) => {
      receivedRequest = [path, body, headers];
      return { bidRequestId: "request-1", status: "RECEIVED" } as T;
    };
    const client: ApiClient = { get: async <T,>() => ({} as T), post };
    render(<BidRequestForm auctionId="auction-1" actorId="local-bidder" client={client} />);

    fireEvent.change(screen.getByLabelText("입찰 금액"), { target: { value: "21000" } });
    fireEvent.click(screen.getByRole("button", { name: "입찰 요청" }));

    await waitFor(() => expect(receivedRequest).not.toEqual([]));
    expect(receivedRequest[0]).toBe("/api/v1/auctions/auction-1/bid-requests");
    expect(receivedRequest[1]).toEqual({ bidKind: "DIRECT", amount: 21000 });
    expect(receivedRequest[2]).toMatchObject({ "X-Actor-Id": "local-bidder" });
    expect(await screen.findByRole("status")).toHaveTextContent("요청 번호: request-1");
  });
});
