import { expect, it, vi } from "vitest";
import { createProtectedApiClient } from "./api-client";

it("uses only the Bearer credential and preserves request metadata", async () => {
  const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ok: true }));
  const client = createProtectedApiClient("https://api.example.test", request, {
    token: () => "access-token", unauthorized: vi.fn(),
  });
  await client.post("/api/v1/listings", {}, {
    "x-actor-id": "local-id", authorization: "override", "Idempotency-Key": "key",
  });
  const [url, init] = request.mock.calls[0]!;
  const headers = new Headers(init?.headers);
  expect(url).toBe("https://api.example.test/api/v1/listings");
  expect(headers.get("Authorization")).toBe("Bearer access-token");
  expect(headers.get("X-Actor-Id")).toBeNull();
  expect(headers.get("Idempotency-Key")).toBe("key");
  expect(init).toMatchObject({ credentials: "omit", redirect: "error" });
});

it("blocks the request if the token is missing or the API is insecure", async () => {
  const request = vi.fn<typeof fetch>();
  const unauthorized = vi.fn();
  await expect(createProtectedApiClient("https://api.example.test", request, {
    token: () => undefined, unauthorized,
  }).get("/api/v1/me")).rejects.toMatchObject({ status: 401 });
  await expect(createProtectedApiClient("http://api.example.test", request, {
    token: () => "access-token", unauthorized,
  }).get("/api/v1/me")).rejects.toThrow();
  expect(request).not.toHaveBeenCalled();
});

it("expires the session for a protected 401 but not a 403", async () => {
  const request = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(null, { status: 403 }))
    .mockResolvedValueOnce(new Response(null, { status: 401 }));
  const unauthorized = vi.fn();
  const client = createProtectedApiClient("https://api.example.test", request, {
    token: () => "access-token", unauthorized,
  });
  await expect(client.get("/api/v1/me")).rejects.toMatchObject({ status: 403 });
  expect(unauthorized).not.toHaveBeenCalled();
  await expect(client.get("/api/v1/me")).rejects.toMatchObject({ status: 401 });
  expect(unauthorized).toHaveBeenCalledTimes(1);
});
