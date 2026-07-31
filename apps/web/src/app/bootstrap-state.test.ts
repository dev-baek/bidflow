import { describe, expect, it } from "vitest";
import { bootstrapReducer, initialBootstrapState } from "./bootstrap-state";

describe("bootstrapReducer", () => {
  it("moves to ready with parsed configuration", () => {
    const config = {
      apiBaseUrl: "https://api.bidflow.example",
      wsBaseUrl: "wss://api.bidflow.example/ws",
    };

    expect(bootstrapReducer(initialBootstrapState, { type: "configLoaded", config })).toEqual({
      status: "ready",
      config,
    });
  });

  it("moves to a visible configuration error", () => {
    expect(
      bootstrapReducer(initialBootstrapState, {
        type: "configFailed",
        message: "환경 설정을 확인하세요.",
      }),
    ).toEqual({ status: "error", message: "환경 설정을 확인하세요." });
  });

  it("returns to loading when configuration is retried", () => {
    expect(
      bootstrapReducer(
        { status: "error", message: "환경 설정을 확인하세요." },
        { type: "retry" },
      ),
    ).toEqual({ status: "loading" });
  });
});
