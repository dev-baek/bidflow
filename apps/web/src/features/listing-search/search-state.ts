export type SearchItem = Readonly<{ productId: string; title: string; categoryId: string; currentPrice: number; status: string; endsAt: string }>;
export type SearchFilters = Readonly<{ keyword: string; categoryId?: string; status?: string; sort: "RELEVANCE" | "ENDING_SOON" | "PRICE_ASC" | "PRICE_DESC" | "NEWEST" }>;
export type SearchState = Readonly<{ mode: "IDLE" | "LOADING" | "RESULTS" | "EMPTY" | "ERROR"; filters: SearchFilters; items: readonly SearchItem[]; nextCursor?: string; message?: string }>;
export type SearchEvent =
  | Readonly<{ type: "FILTER_CHANGED"; field: keyof SearchFilters; value: string }>
  | Readonly<{ type: "SEARCH_REQUESTED" }>
  | Readonly<{ type: "SEARCH_SUCCEEDED"; items: readonly SearchItem[]; nextCursor?: string }>
  | Readonly<{ type: "NEXT_SUCCEEDED"; items: readonly SearchItem[]; nextCursor?: string }>
  | Readonly<{ type: "SEARCH_FAILED"; message: string }>;

export function createSearchState(): SearchState { return { mode: "IDLE", filters: { keyword: "", sort: "RELEVANCE" }, items: [] }; }
export function searchReducer(state: SearchState, event: SearchEvent): SearchState {
  if (event.type === "FILTER_CHANGED") return { ...state, mode: "IDLE", filters: { ...state.filters, [event.field]: event.value || undefined }, items: [], nextCursor: undefined, message: undefined };
  if (event.type === "SEARCH_REQUESTED") return { ...state, mode: "LOADING", message: undefined };
  if (event.type === "SEARCH_FAILED") return { ...state, mode: "ERROR", message: event.message };
  if (event.type === "NEXT_SUCCEEDED") return { ...state, mode: "RESULTS", items: [...state.items, ...event.items], nextCursor: event.nextCursor };
  return { ...state, mode: event.items.length === 0 ? "EMPTY" : "RESULTS", items: event.items, nextCursor: event.nextCursor, message: undefined };
}
