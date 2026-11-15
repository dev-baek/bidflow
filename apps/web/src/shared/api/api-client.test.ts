import { describe, expect, it, vi } from "vitest";
import { ApiError, createApiClient } from "./api-client";

describe("createApiClient", () => {
  it("returns decoded JSON from the requested API path", async () => {
    const request = vi.fn(async () => {
      return new Response(JSON.stringify({ status: "ok" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const client = createApiClient("https://api.bidflow.example/", request);

    await expect(client.get<{ status: string }>("/api/health")).resolves.toEqual({
      status: "ok",
    });
    expect(request).toHaveBeenCalledWith("https://api.bidflow.example/api/health", {
      headers: { accept: "application/json" },
    });
  });

  it("preserves the HTTP status when a request fails", async () => {
    const request = vi.fn(async () => new Response("", { status: 503 }));
    const client = createApiClient("https://api.bidflow.example", request);

    await expect(client.get("/api/health")).rejects.toEqual(new ApiError(503));
  });

  it("serializes JSON request bodies for command endpoints", async () => {
    const request = vi.fn(async () => new Response(JSON.stringify({ bidRequestId: "request-1", status: "RECEIVED" }), { status: 202 }));
    const client = createApiClient("https://api.bidflow.example", request);

    await client.post("/api/v1/auctions/auction-1/bid-requests", { bidKind: "DIRECT", amount: 21000 }, { "Idempotency-Key": "key-1" });

    expect(request).toHaveBeenCalledWith("https://api.bidflow.example/api/v1/auctions/auction-1/bid-requests", expect.objectContaining({
      method: "POST", body: JSON.stringify({ bidKind: "DIRECT", amount: 21000 }), headers: expect.objectContaining({ "Idempotency-Key": "key-1" }),
    }));
  });
});
