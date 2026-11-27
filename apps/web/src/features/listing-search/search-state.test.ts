import { describe, expect, it } from "vitest";
import { createSearchState, readSearchFilters, searchParamsFrom, searchReducer } from "./search-state";
import { remainingTime } from "../../shared/auction-time";

it("formats remaining time without inferring an auction state or rounding up", () => {
  expect(remainingTime(59_999, 0)).toBe("1분 미만");
  expect(remainingTime(66 * 60_000, 0)).toBe("1시간 6분");
  expect(remainingTime(26 * 60 * 60_000, 0)).toBe("1일 2시간");
  expect(remainingTime(0, 0)).toBe("마감 시각 지남");
  expect(remainingTime(Number.NaN, 0)).toBeUndefined();
});

describe("search query", () => {
  it("round-trips filters including a zero bound and converts the deadline to UTC", () => {
    const filters = { keyword: "  카메라  ", categoryId: "DIGITAL", status: "ACTIVE", minPrice: "0", maxPrice: "0", endsBefore: "2030-01-01T12:30", sort: "NEWEST" };
    const result = searchParamsFrom(filters);
    expect(result.params?.get("endsBefore")).toBe("2030-01-01T12:30:00.000Z");
    expect(result.params?.get("minPrice")).toBe("0");
    expect(searchParamsFrom(readSearchFilters(result.params!)).params?.toString()).toBe(result.params?.toString());
  });

  it.each([
    { minPrice: "-1" }, { maxPrice: "12.5" }, { minPrice: "2", maxPrice: "1" },
    { minPrice: "9223372036854775808" }, { endsBefore: "2030-02-30T12:30" },
    { sort: "UNKNOWN" }, { categoryId: "UNKNOWN" }, { status: "ENDED" },
  ])("rejects invalid condition %j", (filters) => {
    expect(searchParamsFrom({ ...createSearchState().filters, ...filters })).toHaveProperty("error");
  });
});

describe("searchReducer", () => {
  it("clears prior results and cursor when a filter changes", () => {
    const loaded = searchReducer(createSearchState(), {
      type: "SEARCH_SUCCEEDED",
      items: [{ productId: "product-1", auctionId: "auction-1", title: "카메라", categoryId: "DIGITAL", currentPrice: 50000, status: "ACTIVE", endsAt: "2026-11-12T01:00:00Z" }],
      nextCursor: "cursor-1",
    });

    const edited = searchReducer(loaded, { type: "FILTER_CHANGED", field: "keyword", value: "렌즈" });
    expect(edited).toMatchObject({
      mode: "IDLE", items: [], filters: { keyword: "렌즈" },
    });
    expect(edited.nextCursor).toBeUndefined();
  });

  it("shows empty and error states distinctly", () => {
    const empty = searchReducer(createSearchState(), { type: "SEARCH_SUCCEEDED", items: [], nextCursor: undefined });
    const failed = searchReducer(empty, { type: "SEARCH_FAILED", message: "검색 서비스를 일시적으로 사용할 수 없습니다." });

    expect(empty.mode).toBe("EMPTY");
    expect(failed).toMatchObject({ mode: "ERROR", message: "검색 서비스를 일시적으로 사용할 수 없습니다." });
  });
});
