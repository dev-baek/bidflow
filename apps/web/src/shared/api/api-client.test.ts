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
});
