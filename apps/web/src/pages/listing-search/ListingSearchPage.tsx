import { useCallback, useEffect, useMemo, useReducer, useRef, type ChangeEvent, type FormEvent } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import {
  createSearchState, readSearchFilters, searchCategories, searchParamsFrom, searchReducer,
  searchSorts, searchStatuses, type SearchFilters, type SearchItem,
} from "../../features/listing-search/search-state";
import { ApiError, createApiClient, joinApiUrl, type ApiClient } from "../../shared/api/api-client";
import { StatusMessage } from "../../shared/ui/Feedback";
import { AuctionPhoto } from "../../shared/ui/AuctionPhoto";

type ApiResponse = { items: SearchItem[]; nextCursor: string | null };
export type ListingSearchPageProps = Readonly<{ apiBaseUrl: string; client?: ApiClient }>;

export function ListingSearchPage({ apiBaseUrl, client }: ListingSearchPageProps) {
  const location = useLocation();
  const defaultClient = useMemo(() => createApiClient(apiBaseUrl, fetch), [apiBaseUrl]);
  return <SearchResults key={location.key} search={location.search} apiBaseUrl={apiBaseUrl} client={client ?? defaultClient} />;
}

function SearchResults({ search, apiBaseUrl, client }: { search: string; apiBaseUrl: string; client: ApiClient }) {
  const [, setSearchParams] = useSearchParams();
  const [state, dispatch] = useReducer(searchReducer, search, value => createSearchState(readSearchFilters(new URLSearchParams(value))));
  const inFlight = useRef<symbol | undefined>(undefined);
  const load = useCallback(async (filters: SearchFilters, cursor?: string) => {
    if (inFlight.current) return;
    const { params, error } = searchParamsFrom(filters);
    if (!params) {
      dispatch({ type: "SEARCH_FAILED", message: error });
      return;
    }
    if (cursor) params.set("cursor", cursor);
    const request = Symbol();
    inFlight.current = request;
    dispatch({ type: "SEARCH_REQUESTED", cursor });
    try {
      const page = await client.get<ApiResponse>(`/api/v1/listings/search?${params.toString()}`);
      if (inFlight.current !== request) return;
      dispatch({ type: cursor ? "NEXT_SUCCEEDED" : "SEARCH_SUCCEEDED", items: page.items, nextCursor: page.nextCursor ?? undefined });
    } catch (cause) {
      if (inFlight.current !== request) return;
      if (cause instanceof ApiError && cause.status === 400) {
        dispatch({ type: "SEARCH_FAILED", message: "검색 조건을 확인한 뒤 다시 검색하세요." });
      } else {
        dispatch({ type: "SEARCH_FAILED", message: "검색 서비스를 일시적으로 사용할 수 없습니다.", retry: { cursor } });
      }
    } finally {
      if (inFlight.current === request) inFlight.current = undefined;
    }
  }, [client]);

  useEffect(() => {
    if (search) void load(readSearchFilters(new URLSearchParams(search)));
    return () => { inFlight.current = undefined; };
  }, [load, search]);

  const change = (field: keyof SearchFilters) => (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    inFlight.current = undefined;
    dispatch({ type: "FILTER_CHANGED", field, value: event.target.value });
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const { params, error } = searchParamsFrom(state.filters);
    if (!params) {
      dispatch({ type: "SEARCH_FAILED", message: error });
      return;
    }
    setSearchParams(params, { replace: search === `?${params.toString()}` });
  };

  const { filters, items, mode, nextCursor, retry } = state;
  return (
    <main className="app-shell listing-shell">
      <section className="listing-form">
        <p className="eyebrow">PRODUCT SEARCH</p>
        <h1>상품 검색</h1>
        <form noValidate onSubmit={submit}>
          <div className="form-field">
            <label htmlFor="search-keyword">검색어</label>
            <input id="search-keyword" value={filters.keyword} onChange={change("keyword")} />
          </div>
          <div className="form-grid">
            <div className="form-field">
              <label htmlFor="search-category">카테고리</label>
              <select id="search-category" value={filters.categoryId} onChange={change("categoryId")}>
                <option value="">전체</option>
                {Object.entries(searchCategories).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </div>
            <div className="form-field">
              <label htmlFor="search-status">경매 상태</label>
              <select id="search-status" value={filters.status} onChange={change("status")}>
                <option value="">전체</option>
                {Object.entries(searchStatuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </div>
            <div className="form-field">
              <label htmlFor="search-min-price">최소 가격 (원)</label>
              <input id="search-min-price" inputMode="numeric" value={filters.minPrice} onChange={change("minPrice")} />
            </div>
            <div className="form-field">
              <label htmlFor="search-max-price">최대 가격 (원)</label>
              <input id="search-max-price" inputMode="numeric" value={filters.maxPrice} onChange={change("maxPrice")} />
            </div>
            <div className="form-field">
              <label htmlFor="search-ends-before">마감 시각 이전 (UTC)</label>
              <input id="search-ends-before" type="datetime-local" step="0.001" value={filters.endsBefore} onChange={change("endsBefore")} />
            </div>
            <div className="form-field">
              <label htmlFor="search-sort">정렬</label>
              <select id="search-sort" value={filters.sort} onChange={change("sort")}>
                {Object.entries(searchSorts).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </div>
          </div>
          <div className="form-grid">
            <button type="submit" disabled={mode === "LOADING"}>검색</button>
            <button type="button" onClick={() => setSearchParams({}, { replace: !search })}>필터 초기화</button>
          </div>
        </form>
        {mode === "LOADING" && <StatusMessage kind="loading">검색 중입니다.</StatusMessage>}
        {mode === "EMPTY" && <StatusMessage kind="empty">조건에 맞는 상품이 없습니다.</StatusMessage>}
        {mode === "ERROR" && <StatusMessage kind="error">{state.message ?? "검색 결과를 불러오지 못했습니다."}</StatusMessage>}
        {retry && <button type="button" onClick={() => void load(filters, retry.cursor)}>다시 시도</button>}
        <ul>
          {items.map(item => (
            <li key={item.productId}>
              <div className="auction-search-thumbnail">
                <AuctionPhoto
                  src={item.hasThumbnail && item.auctionId
                    ? joinApiUrl(apiBaseUrl, `/api/v1/auctions/${encodeURIComponent(item.auctionId)}/images/thumbnail`) : undefined}
                  alt={`${item.title} 대표 사진`} />
              </div>
              <strong>{item.auctionId ? <Link to={`/auctions/${item.auctionId}`}>{item.title}</Link> : item.title}</strong>
              <p>{searchCategories[item.categoryId as keyof typeof searchCategories] ?? item.categoryId} · {item.currentPrice.toLocaleString()}원 · {searchStatuses[item.status as keyof typeof searchStatuses] ?? item.status}</p>
              <time dateTime={item.endsAt}>{new Date(item.endsAt).toLocaleString("ko-KR", { timeZone: "UTC" })} UTC</time>
            </li>
          ))}
        </ul>
        {nextCursor && <button type="button" onClick={() => void load(filters, nextCursor)}>다음 결과</button>}
      </section>
    </main>
  );
}
