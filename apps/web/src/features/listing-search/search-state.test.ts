import { describe, expect, it } from "vitest";
import { createSearchState, searchReducer } from "./search-state";

describe("searchReducer", () => {
  it("clears prior results and cursor when a filter changes", () => {
    const loaded = searchReducer(createSearchState(), {
      type: "SEARCH_SUCCEEDED",
      items: [{ productId: "product-1", title: "카메라", categoryId: "DIGITAL", currentPrice: 50000, status: "ACTIVE", endsAt: "2026-11-12T01:00:00Z" }],
      nextCursor: "cursor-1",
    });

    expect(searchReducer(loaded, { type: "FILTER_CHANGED", field: "keyword", value: "렌즈" })).toMatchObject({
      mode: "IDLE", items: [], nextCursor: undefined, filters: { keyword: "렌즈" },
    });
  });

  it("shows empty and error states distinctly", () => {
    const empty = searchReducer(createSearchState(), { type: "SEARCH_SUCCEEDED", items: [], nextCursor: undefined });
    const failed = searchReducer(empty, { type: "SEARCH_FAILED", message: "검색 서비스를 일시적으로 사용할 수 없습니다." });

    expect(empty.mode).toBe("EMPTY");
    expect(failed).toMatchObject({ mode: "ERROR", message: "검색 서비스를 일시적으로 사용할 수 없습니다." });
  });
});
