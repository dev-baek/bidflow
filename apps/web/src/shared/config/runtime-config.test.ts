import { describe, expect, it } from "vitest";
import { parseRuntimeConfig } from "./runtime-config";

describe("parseRuntimeConfig", () => {
  it("returns normalized public endpoints", () => {
    expect(
      parseRuntimeConfig({
        VITE_API_BASE_URL: "https://api.bidflow.example/",
        VITE_WS_BASE_URL: "wss://api.bidflow.example/ws",
      }),
    ).toEqual({
      ok: true,
      value: {
        apiBaseUrl: "https://api.bidflow.example",
        wsBaseUrl: "wss://api.bidflow.example/ws",
      },
    });
  });

  it.each([
    [{ VITE_WS_BASE_URL: "wss://api.bidflow.example/ws" }, "VITE_API_BASE_URL"],
    [
      {
        VITE_API_BASE_URL: "ftp://api.bidflow.example",
        VITE_WS_BASE_URL: "wss://api.bidflow.example/ws",
      },
      "VITE_API_BASE_URL",
    ],
    [
      {
        VITE_API_BASE_URL: "https://api.bidflow.example",
        VITE_WS_BASE_URL: "https://api.bidflow.example/ws",
      },
      "VITE_WS_BASE_URL",
    ],
  ] as const)("rejects invalid %s input", (input, field) => {
    expect(parseRuntimeConfig(input)).toEqual({
      ok: false,
      message: `${field} 설정을 확인하세요.`,
    });
  });
});
