import { useReducer, type FormEvent } from "react";
import { createSearchState, searchReducer } from "../../features/listing-search/search-state";
import { createApiClient, type ApiClient } from "../../shared/api/api-client";

type ApiResponse = { items: Array<{ productId: string; title: string; categoryId: string; currentPrice: number; status: string; endsAt: string }>; nextCursor: string | null };
export type ListingSearchPageProps = Readonly<{ apiBaseUrl: string; client?: ApiClient }>;

export function buildSearchPath(filters: ReturnType<typeof createSearchState>["filters"], cursor?: string) {
  const params = new URLSearchParams({ q: filters.keyword, sort: filters.sort });
  if (filters.categoryId) params.set("categoryId", filters.categoryId);
  if (filters.status) params.set("status", filters.status);
  if (cursor) params.set("cursor", cursor);
  return `/api/v1/listings/search?${params.toString()}`;
}

export function ListingSearchPage({ apiBaseUrl, client = createApiClient(apiBaseUrl, fetch) }: ListingSearchPageProps) {
  const [state, dispatch] = useReducer(searchReducer, undefined, createSearchState);
  const load = async (cursor?: string) => { dispatch({ type: "SEARCH_REQUESTED" }); try { const page = await client.get<ApiResponse>(buildSearchPath(state.filters, cursor)); dispatch(cursor ? { type: "NEXT_SUCCEEDED", items: page.items, nextCursor: page.nextCursor ?? undefined } : { type: "SEARCH_SUCCEEDED", items: page.items, nextCursor: page.nextCursor ?? undefined }); } catch { dispatch({ type: "SEARCH_FAILED", message: "검색 서비스를 일시적으로 사용할 수 없습니다." }); } };
  const submit = (event: FormEvent) => { event.preventDefault(); void load(); };
  return <main className="app-shell"><section className="listing-form"><p className="eyebrow">PRODUCT SEARCH</p><h1>상품 검색</h1><form onSubmit={submit}><label>검색어<input aria-label="검색어" value={state.filters.keyword} onChange={(event) => dispatch({ type: "FILTER_CHANGED", field: "keyword", value: event.target.value })} /></label><label>정렬<select aria-label="정렬" value={state.filters.sort} onChange={(event) => dispatch({ type: "FILTER_CHANGED", field: "sort", value: event.target.value })}><option value="RELEVANCE">관련도순</option><option value="ENDING_SOON">마감 임박순</option><option value="PRICE_ASC">낮은 가격순</option><option value="PRICE_DESC">높은 가격순</option></select></label><button type="submit">검색</button></form>{state.mode === "LOADING" && <p role="status">검색 중입니다.</p>}{state.mode === "EMPTY" && <p>조건에 맞는 상품이 없습니다.</p>}{state.mode === "ERROR" && <p role="alert">{state.message}</p>}<ul>{state.items.map((item) => <li key={item.productId}><strong>{item.title}</strong><span>{item.currentPrice.toLocaleString()}원 · {item.status}</span></li>)}</ul>{state.nextCursor && <button onClick={() => void load(state.nextCursor)}>다음 결과</button>}</section></main>;
}
