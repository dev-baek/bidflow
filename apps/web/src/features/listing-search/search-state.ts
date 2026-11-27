export type SearchItem = Readonly<{ productId: string; auctionId: string | null; title: string; categoryId: string; hasThumbnail?: boolean; currentPrice: number; status: string; endsAt: string }>;
export const searchCategories = { DIGITAL: "디지털·가전", FASHION: "패션", HOBBY: "취미·컬렉션", LIVING: "생활·가구" };
export const searchStatuses = { SCHEDULED: "예정", ACTIVE: "진행 중" };
export const searchSorts = { RELEVANCE: "관련도순", ENDING_SOON: "마감 임박순", PRICE_ASC: "낮은 가격순", PRICE_DESC: "높은 가격순", NEWEST: "최근 공개 시작순" };

export function remainingTime(endsAt: number, now: number): string | undefined {
  if (!Number.isFinite(endsAt)) return undefined;
  if (endsAt <= now) return "마감 시각 지남";
  const minutes = Math.floor((endsAt - now) / 60_000);
  if (minutes >= 1440) return `${Math.floor(minutes / 1440)}일 ${Math.floor(minutes / 60) % 24}시간`;
  if (minutes >= 60) return `${Math.floor(minutes / 60)}시간 ${minutes % 60}분`;
  return minutes > 0 ? `${minutes}분` : "1분 미만";
}

export type SearchFilters = Readonly<{
  keyword: string; categoryId: string; status: string; minPrice: string; maxPrice: string; endsBefore: string; sort: string;
}>;
export type SearchState = Readonly<{
  mode: "IDLE" | "LOADING" | "RESULTS" | "EMPTY" | "ERROR";
  filters: SearchFilters; items: readonly SearchItem[]; nextCursor?: string; message?: string; retry?: { cursor?: string };
}>;
export type SearchEvent =
  | Readonly<{ type: "FILTER_CHANGED"; field: keyof SearchFilters; value: string }>
  | Readonly<{ type: "SEARCH_REQUESTED"; cursor?: string }>
  | Readonly<{ type: "SEARCH_SUCCEEDED"; items: readonly SearchItem[]; nextCursor?: string }>
  | Readonly<{ type: "NEXT_SUCCEEDED"; items: readonly SearchItem[]; nextCursor?: string }>
  | Readonly<{ type: "SEARCH_FAILED"; message: string; retry?: { cursor?: string } }>;

export function readSearchFilters(params: URLSearchParams): SearchFilters {
  return {
    keyword: params.get("q") ?? "",
    categoryId: params.get("categoryId") ?? "",
    status: params.get("status") ?? "",
    minPrice: params.get("minPrice") ?? "",
    maxPrice: params.get("maxPrice") ?? "",
    endsBefore: (params.get("endsBefore") ?? "").replace(/Z$/, ""),
    sort: params.get("sort") ?? "RELEVANCE",
  };
}

function utcInstant(value: string): string | undefined {
  const parts = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(value);
  if (!parts) return undefined;
  const instant = `${parts[1]}:${parts[2] ?? "00"}.${(parts[3] ?? "").padEnd(3, "0")}Z`;
  const date = new Date(instant);
  return Number.isNaN(date.valueOf()) || date.toISOString() !== instant ? undefined : instant;
}

function price(value: string): bigint | undefined {
  if (!/^\d{1,19}$/.test(value)) return undefined;
  const amount = BigInt(value);
  return amount <= 9_223_372_036_854_775_807n ? amount : undefined;
}

export function searchParamsFrom(filters: SearchFilters): { params: URLSearchParams; error?: never } | { params?: never; error: string } {
  const keyword = filters.keyword.trim();
  if (keyword.length > 100) return { error: "검색어는 100자 이하여야 합니다." };
  if ((filters.categoryId && !Object.hasOwn(searchCategories, filters.categoryId))
    || (filters.status && !Object.hasOwn(searchStatuses, filters.status)) || !Object.hasOwn(searchSorts, filters.sort)) {
    return { error: "카테고리, 경매 상태 또는 정렬 조건을 확인하세요." };
  }
  const min = price(filters.minPrice);
  const max = price(filters.maxPrice);
  if ((filters.minPrice && min === undefined) || (filters.maxPrice && max === undefined)) {
    return { error: "가격은 0 이상의 정수로 입력하세요. (최대 9,223,372,036,854,775,807원)" };
  }
  if (min !== undefined && max !== undefined && min > max) return { error: "최소 가격은 최대 가격보다 클 수 없습니다." };
  const endsBefore = utcInstant(filters.endsBefore);
  if (filters.endsBefore && !endsBefore) return { error: "마감 시각을 올바른 UTC 날짜와 시간으로 입력하세요." };

  const params = new URLSearchParams();
  if (keyword) params.set("q", keyword);
  if (filters.categoryId) params.set("categoryId", filters.categoryId);
  if (filters.status) params.set("status", filters.status);
  if (min !== undefined) params.set("minPrice", min.toString());
  if (max !== undefined) params.set("maxPrice", max.toString());
  if (endsBefore) params.set("endsBefore", endsBefore);
  params.set("sort", filters.sort);
  return { params };
}

export function createSearchState(filters = readSearchFilters(new URLSearchParams())): SearchState {
  return { mode: "IDLE", filters, items: [] };
}

export function searchReducer(state: SearchState, event: SearchEvent): SearchState {
  if (event.type === "FILTER_CHANGED") return createSearchState({ ...state.filters, [event.field]: event.value });
  if (event.type === "SEARCH_REQUESTED") {
    return { ...state, mode: "LOADING", items: event.cursor ? state.items : [], nextCursor: undefined, message: undefined, retry: undefined };
  }
  if (event.type === "SEARCH_FAILED") return { ...state, mode: "ERROR", message: event.message, retry: event.retry };
  if (event.type === "NEXT_SUCCEEDED") return { ...state, mode: "RESULTS", items: [...state.items, ...event.items], nextCursor: event.nextCursor };
  return { ...state, mode: event.items.length === 0 ? "EMPTY" : "RESULTS", items: event.items, nextCursor: event.nextCursor, message: undefined };
}
