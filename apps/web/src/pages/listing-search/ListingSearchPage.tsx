import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import {
  createSearchState, readSearchFilters, remainingTime, searchCategories, searchParamsFrom, searchReducer,
  searchSorts, searchStatuses, type SearchFilters, type SearchItem,
} from "../../features/listing-search/search-state";
import { ApiError, createApiClient, joinApiUrl, type ApiClient } from "../../shared/api/api-client";
import { Badge, StatusMessage } from "../../shared/ui/Feedback";
import { AuctionPhoto } from "../../shared/ui/AuctionPhoto";
import { Button } from "../../shared/ui/Button";
import { Field } from "../../shared/ui/Field";
import { PageLayout } from "../../shared/ui/PageLayout";

type ApiResponse = { items: SearchItem[]; nextCursor: string | null };
const dateFormat = new Intl.DateTimeFormat("ko-KR", { timeZone: "UTC", dateStyle: "medium", timeStyle: "short", hourCycle: "h23" });
export type ListingSearchPageProps = Readonly<{ apiBaseUrl: string; client?: ApiClient }>;

export function ListingSearchPage({ apiBaseUrl, client }: ListingSearchPageProps) {
  const location = useLocation();
  const defaultClient = useMemo(() => createApiClient(apiBaseUrl, fetch), [apiBaseUrl]);
  return <SearchResults key={location.key} search={location.search} apiBaseUrl={apiBaseUrl} client={client ?? defaultClient} />;
}

function SearchResults({ search, apiBaseUrl, client }: { search: string; apiBaseUrl: string; client: ApiClient }) {
  const [, setSearchParams] = useSearchParams();
  const [state, dispatch] = useReducer(searchReducer, search, value => createSearchState(readSearchFilters(new URLSearchParams(value))));
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [now, setNow] = useState(Date.now);
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
      setNow(Date.now());
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
  const hasItems = items.length > 0;
  useEffect(() => {
    if (!hasItems) return;
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [hasItems]);

  const applied = readSearchFilters(new URLSearchParams(search));
  const appliedConditions = search && searchParamsFrom(applied).params ? [
    applied.keyword && `검색어: ${applied.keyword}`,
    searchCategories[applied.categoryId as keyof typeof searchCategories],
    searchStatuses[applied.status as keyof typeof searchStatuses],
    applied.minPrice && `${BigInt(applied.minPrice).toLocaleString("ko-KR")}원 이상`,
    applied.maxPrice && `${BigInt(applied.maxPrice).toLocaleString("ko-KR")}원 이하`,
    applied.endsBefore && `마감: ${dateFormat.format(Date.parse(applied.endsBefore + "Z"))} UTC까지`,
    `정렬: ${searchSorts[applied.sort as keyof typeof searchSorts]}`,
  ].filter(Boolean) : [];

  return (
    <PageLayout>
      <form className="market-search" noValidate onSubmit={submit}>
        <h1>상품 검색</h1>
        <div className="market-search__keyword">
          <Field id="search-keyword" label="검색어">
            {(control) => <input {...control} type="search" value={filters.keyword} onChange={change("keyword")} placeholder="상품명을 입력하세요" />}
          </Field>
          <Button type="submit" disabled={mode === "LOADING"}>검색</Button>
        </div>
        <div className="market-search__workspace">
          <aside className="market-search__filters" aria-label="검색 조건">
            <h2>검색 조건</h2>
            <Button className="market-search__toggle" variant="secondary" aria-expanded={filtersOpen}
              aria-controls="search-filters" onClick={() => setFiltersOpen(open => !open)}>검색 조건</Button>
            <div id="search-filters" className="market-search__controls" data-expanded={filtersOpen}>
              <Field id="search-category" label="카테고리">
                {(control) => <select {...control} value={filters.categoryId} onChange={change("categoryId")}>
                  <option value="">전체</option>
                  {Object.entries(searchCategories).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>}
              </Field>
              <Field id="search-status" label="경매 상태">
                {(control) => <select {...control} value={filters.status} onChange={change("status")}>
                  <option value="">전체</option>
                  {Object.entries(searchStatuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>}
              </Field>
              <Field id="search-min-price" label="최소 가격 (원)">
                {(control) => <input {...control} inputMode="numeric" value={filters.minPrice} onChange={change("minPrice")} />}
              </Field>
              <Field id="search-max-price" label="최대 가격 (원)">
                {(control) => <input {...control} inputMode="numeric" value={filters.maxPrice} onChange={change("maxPrice")} />}
              </Field>
              <Field id="search-ends-before" label="마감 시각 이전 (UTC)">
                {(control) => <input {...control} type="datetime-local" step="0.001" value={filters.endsBefore} onChange={change("endsBefore")} />}
              </Field>
              <Button type="submit" disabled={mode === "LOADING"}>조건 적용</Button>
              <Button variant="ghost" onClick={() => setSearchParams({}, { replace: !search })}>필터 초기화</Button>
            </div>
          </aside>
          <section className="market-search__results" aria-labelledby="search-results-title">
            <div className="market-search__result-header">
              <div>
                <h2 id="search-results-title">검색 결과</h2>
                {hasItems && <p>표시 중 {items.length}개</p>}
              </div>
              <div className="market-search__sort">
                <Field id="search-sort" label="정렬">
                  {(control) => <select {...control} value={filters.sort} onChange={change("sort")}>
                    {Object.entries(searchSorts).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>}
                </Field>
                <Button variant="secondary" type="submit" disabled={mode === "LOADING"}>정렬 적용</Button>
              </div>
            </div>
            {appliedConditions.length > 0 && <div role="group" aria-label="적용된 검색 조건" className="market-search__applied">
              {appliedConditions.map(label => <Badge key={label}>{label}</Badge>)}
            </div>}
            {mode === "IDLE" && !search && <StatusMessage kind="empty">검색어나 조건을 입력하고 검색해 보세요.</StatusMessage>}
            {mode === "LOADING" && <StatusMessage kind="loading">검색 중입니다.</StatusMessage>}
            {mode === "EMPTY" && <StatusMessage kind="empty">조건에 맞는 상품이 없습니다.</StatusMessage>}
            {mode === "ERROR" && <StatusMessage kind="error">{state.message ?? "검색 결과를 불러오지 못했습니다."}</StatusMessage>}
            {hasItems && <ul className="market-search__list" role="list">
              {items.map(item => <ResultCard key={item.productId} item={item} apiBaseUrl={apiBaseUrl} now={now} />)}
            </ul>}
            {(retry || nextCursor) && <div className="market-search__next">
              {retry && <Button variant="secondary" onClick={() => void load(filters, retry.cursor)}>다시 시도</Button>}
              {nextCursor && <Button variant="secondary" onClick={() => void load(filters, nextCursor)}>다음 결과</Button>}
            </div>}
          </section>
        </div>
      </form>
    </PageLayout>
  );
}

function ResultCard({ item, apiBaseUrl, now }: Readonly<{ item: SearchItem; apiBaseUrl: string; now: number }>) {
  const deadline = Date.parse(item.endsAt);
  const remaining = remainingTime(deadline, now);
  const status = Object.hasOwn(searchStatuses, item.status) ? searchStatuses[item.status as keyof typeof searchStatuses] : undefined;
  const category = Object.hasOwn(searchCategories, item.categoryId) ? searchCategories[item.categoryId as keyof typeof searchCategories] : undefined;
  return <li className="market-search__card">
    <AuctionPhoto
      src={item.hasThumbnail && item.auctionId
        ? joinApiUrl(apiBaseUrl, `/api/v1/auctions/${encodeURIComponent(item.auctionId)}/images/thumbnail`) : undefined}
      alt={`${item.title} 대표 사진`} />
    <div className="market-search__trade">
      <h3>{item.auctionId ? <Link to={`/auctions/${encodeURIComponent(item.auctionId)}`}>{item.title}</Link> : item.title}</h3>
      <p className="market-search__price">현재가 <strong>{item.currentPrice.toLocaleString("ko-KR")}원</strong></p>
      {remaining && <p><span>{deadline > now ? `남은 시간 ${remaining}` : remaining}</span>
        <time dateTime={item.endsAt}>{dateFormat.format(deadline)} UTC</time></p>}
      <p className="market-search__card-meta">
        <Badge tone={item.status === "ACTIVE" ? "success" : "neutral"}>{status ?? "상태 확인 불가"}</Badge>
        {category && <span>{category}</span>}
      </p>
    </div>
  </li>;
}
