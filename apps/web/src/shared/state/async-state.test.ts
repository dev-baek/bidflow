import { describe, expect, it } from "vitest";
import { initialAsyncState, reduceAsyncState } from "./async-state";

describe("reduceAsyncState", () => {
  it("starts loading from idle", () => {
    expect(reduceAsyncState(initialAsyncState<string>(), { type: "load" })).toEqual({
      status: "loading",
    });
  });

  it("keeps returned data on success", () => {
    expect(
      reduceAsyncState({ status: "loading" }, { type: "succeed", data: ["auction"] }),
    ).toEqual({ status: "success", data: ["auction"] });
  });

  it("represents an empty array as an empty result", () => {
    expect(reduceAsyncState({ status: "loading" }, { type: "succeed", data: [] })).toEqual({
      status: "empty",
    });
  });

  it("keeps an error message", () => {
    expect(
      reduceAsyncState<string[]>({ status: "loading" }, {
        type: "fail",
        message: "목록을 불러오지 못했습니다.",
      }),
    ).toEqual({ status: "error", message: "목록을 불러오지 못했습니다." });
  });

  it("starts loading again when an error is retried", () => {
    expect(
      reduceAsyncState<string[]>(
        { status: "error", message: "목록을 불러오지 못했습니다." },
        { type: "retry" },
      ),
    ).toEqual({ status: "loading" });
  });

  it("does not mutate the previous state", () => {
    const previous = Object.freeze({
      status: "success" as const,
      data: Object.freeze(["auction"]),
    });

    reduceAsyncState(previous, { type: "load" });

    expect(previous).toEqual({ status: "success", data: ["auction"] });
  });
});
