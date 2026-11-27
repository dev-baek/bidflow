import { describe, expect, it } from "vitest";
import { parseRuntimeConfig } from "./runtime-config";

describe("parseRuntimeConfig", () => {
  it("returns normalized public endpoints", () => {
    expect(
      parseRuntimeConfig({
        VITE_API_BASE_URL: "http://localhost:8080/",
        VITE_WS_BASE_URL: "ws://localhost:8080/ws",
      }),
    ).toEqual({
      ok: true,
      value: {
        apiBaseUrl: "http://localhost:8080",
        wsBaseUrl: "ws://localhost:8080/ws",
      },
    });
  });

  it("requires complete Cognito configuration for deployed endpoints", () => {
    const endpoints = { VITE_API_BASE_URL: "https://api.example.test", VITE_WS_BASE_URL: "wss://api.example.test/ws" };
    const cognito = { VITE_AUTH_MODE: "cognito", VITE_COGNITO_ISSUER: "https://issuer.example.test/pool",
      VITE_COGNITO_ORIGIN: "https://login.example.test", VITE_COGNITO_CLIENT_ID: "publicclient",
      VITE_COGNITO_REDIRECT_URI: "https://app.example.test/auth/callback" };
    expect(parseRuntimeConfig({ ...endpoints, ...cognito })).toMatchObject({
      ok: true, value: { cognito: { redirectUri: cognito.VITE_COGNITO_REDIRECT_URI } },
    });
    expect(parseRuntimeConfig(endpoints).ok).toBe(false);
    expect(parseRuntimeConfig({ ...endpoints, VITE_AUTH_MODE: "local" }).ok).toBe(false);
    expect(parseRuntimeConfig({ ...endpoints, ...cognito, VITE_COGNITO_CLIENT_ID: "" }).ok).toBe(false);
    expect(parseRuntimeConfig({ ...endpoints, ...cognito, VITE_COGNITO_REDIRECT_URI: "https://app.example.test/other" }).ok).toBe(false);
    expect(parseRuntimeConfig({ VITE_API_BASE_URL: "http://localhost:8080", VITE_WS_BASE_URL: "ws://localhost:8080",
      VITE_COGNITO_CLIENT_ID: "publicclient" }).ok).toBe(false);
  });

  it.each([
    [{ VITE_WS_BASE_URL: "wss://api.bidflow.example/ws" }, "api-url"],
    [
      {
        VITE_API_BASE_URL: "ftp://do-not-render-this-value.example.test",
        VITE_WS_BASE_URL: "wss://api.bidflow.example/ws",
      },
      "api-url",
    ],
    [
      {
        VITE_API_BASE_URL: "https://api.bidflow.example",
        VITE_WS_BASE_URL: "https://api.bidflow.example/ws",
      },
      "ws-url",
    ],
  ] as const)("rejects invalid %s input without retaining supplied values", (input, reason) => {
    expect(parseRuntimeConfig(input)).toEqual({
      ok: false,
      reason,
    });
  });
});
