import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { ListingSearchPage } from "./ListingSearchPage";
import { ApiError } from "../../shared/api/api-client";

afterEach(cleanup);

const item = { productId: "product-1", auctionId: "auction-1", title: "카메라", categoryId: "DIGITAL", currentPrice: 10_000, status: "ACTIVE", endsAt: "2030-01-01T12:30:00Z" };
const submit = () => fireEvent.click(screen.getByRole("button", { name: /^검색$/ }));
const change = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label, { exact: true }), { target: { value } });
const createGet = () => vi.fn<(path: string) => Promise<unknown>>();
type SearchGetMock = ReturnType<typeof createGet>;
const query = (get: SearchGetMock, call = 0) => new URL(String(get.mock.calls[call]?.[0]), "http://api").searchParams;

function mount(get: SearchGetMock, initial = "/listings") {
  function History() {
    const location = useLocation();
    const navigate = useNavigate();
    return <><output aria-label="URL">{location.pathname}{location.search}</output><button onClick={() => navigate(-1)}>뒤로</button></>;
  }
  const client = { get: <T,>(path: string) => get(path) as Promise<T>, post: vi.fn() };
  return render(<MemoryRouter initialEntries={[initial]}><History /><ListingSearchPage apiBaseUrl="http://api" client={client} /></MemoryRouter>);
}

it("uses the auction thumbnail route and falls back without losing search results", async () => {
  const get = createGet().mockResolvedValue({ items: [{ ...item, hasThumbnail: true }], nextCursor: null });
  mount(get, "/listings?q=카메라");
  const photo = await screen.findByRole("img", { name: "카메라 대표 사진" });
  expect(photo).toHaveAttribute("src", "http://api/api/v1/auctions/auction-1/images/thumbnail");
  fireEvent.error(photo);
  expect(screen.getByText("사진 없음")).toBeVisible();
  expect(screen.getByRole("link", { name: "카메라" })).toBeVisible();
});

it("applies all filters with an empty query only on submit and restores them on history navigation", async () => {
  const get = createGet().mockResolvedValue({ items: [item], nextCursor: null });
  mount(get, "/listings?q=이전&sort=RELEVANCE");
  await screen.findByRole("link", { name: "카메라" });
  change("검색어", "");
  change("카테고리", "DIGITAL");
  change("경매 상태", "ACTIVE");
  change("최소 가격 (원)", "0");
  change("최대 가격 (원)", "10000");
  change("마감 시각 이전 (UTC)", "2030-01-01T12:30");
  change("정렬", "NEWEST");
  expect(get).toHaveBeenCalledTimes(1);
  submit();
  const card = await screen.findByRole("link", { name: "카메라" });
  expect(within(card.closest("li")!).getByText(/디지털/)).toBeVisible();
  expect(card.closest("li")?.querySelector("time")).toHaveAttribute("datetime", item.endsAt);
  expect(Object.fromEntries(query(get, 1))).toEqual({ categoryId: "DIGITAL", status: "ACTIVE", minPrice: "0", maxPrice: "10000", endsBefore: "2030-01-01T12:30:00.000Z", sort: "NEWEST" });
  expect(screen.getByLabelText("URL")).toHaveTextContent("sort=NEWEST");
  fireEvent.click(screen.getByRole("button", { name: "뒤로" }));
  await screen.findByRole("link", { name: "카메라" });
  expect(screen.getByLabelText("검색어")).toHaveValue("이전");
  expect(screen.getByLabelText("최소 가격 (원)")).toHaveValue("");
  expect(query(get, 2).get("q")).toBe("이전");
});

it("separates invalid input, service failure and empty results, then clears the URL on reset", async () => {
  const get = createGet().mockRejectedValueOnce(new ApiError(503)).mockResolvedValue({ items: [], nextCursor: null });
  mount(get);
  change("최소 가격 (원)", "20");
  change("최대 가격 (원)", "10");
  submit();
  expect(screen.getByRole("alert")).toHaveTextContent(/최소 가격/);
  expect(get).not.toHaveBeenCalled();
  change("최대 가격 (원)", "20");
  submit();
  expect(await screen.findByRole("alert")).toHaveTextContent(/일시적으로/);
  fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
  await screen.findByText("조건에 맞는 상품이 없습니다.");
  expect(get.mock.calls[1]).toEqual(get.mock.calls[0]);
  fireEvent.click(screen.getByRole("button", { name: "필터 초기화" }));
  expect(screen.getByLabelText("URL")).toHaveTextContent(/^\/listings$/);
  expect(screen.queryByText("조건에 맞는 상품이 없습니다.")).not.toBeInTheDocument();
});

it.each(["success", "failure"])("retries the same cursor, prevents duplicates and ignores outdated %s after editing", async (outcome) => {
  let resolveLate!: (value: unknown) => void;
  let rejectLate!: (error: Error) => void;
  const get = createGet()
    .mockResolvedValueOnce({ items: [item], nextCursor: "p2" })
    .mockRejectedValueOnce(new ApiError(503))
    .mockResolvedValueOnce({ items: [{ ...item, productId: "p2", title: "렌즈" }], nextCursor: "p3" })
    .mockReturnValueOnce(new Promise((resolve, reject) => { resolveLate = resolve; rejectLate = reject; }))
    .mockResolvedValueOnce({ items: [], nextCursor: null });
  mount(get);
  submit();
  const next = await screen.findByRole("button", { name: "다음 결과" });
  fireEvent.click(next);
  fireEvent.click(next);
  await screen.findByRole("alert");
  expect(get).toHaveBeenCalledTimes(2);
  expect(screen.getByText("카메라")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
  await screen.findByText("렌즈");
  expect(query(get, 2).get("cursor")).toBe("p2");
  fireEvent.click(screen.getByRole("button", { name: "다음 결과" }));
  change("검색어", "새 검색");
  expect(screen.queryByText("렌즈")).not.toBeInTheDocument();
  submit();
  await screen.findByText("조건에 맞는 상품이 없습니다.");
  await act(async () => {
    if (outcome === "success") resolveLate({ items: [{ ...item, title: "오래된 응답" }], nextCursor: null });
    else rejectLate(new ApiError(503));
  });
  expect(screen.queryByText("오래된 응답")).not.toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(query(get, 4).has("cursor")).toBe(false);
});

it("does not send an invalid bookmarked query and does not retry a server 400", async () => {
  const get = createGet().mockRejectedValue(new ApiError(400));
  mount(get, "/listings?minPrice=-1");
  expect(await screen.findByRole("alert")).toHaveTextContent(/정수/);
  expect(get).not.toHaveBeenCalled();
  change("최소 가격 (원)", "0");
  submit();
  expect(await screen.findByRole("alert")).toHaveTextContent(/검색 조건/);
  expect(screen.queryByRole("button", { name: "다시 시도" })).not.toBeInTheDocument();
});

it("links the auction ID and keeps a legacy result visible without a link", async () => {
  const item = { categoryId: "DIGITAL", currentPrice: 10_000, status: "ACTIVE", endsAt: "2030-01-01T12:30:00Z" };
  const client = {
    get: vi.fn().mockResolvedValue({ items: [
      { ...item, productId: "product-1", auctionId: "auction-1", title: "카메라" },
      { ...item, productId: "product-2", auctionId: null, title: "이전 문서" },
    ], nextCursor: null }),
    post: vi.fn(),
  };
  render(<MemoryRouter><ListingSearchPage apiBaseUrl="http://api" client={client} /></MemoryRouter>);

  fireEvent.click(screen.getByRole("button", { name: "검색" }));

  expect(await screen.findByRole("link", { name: "카메라" }, { timeout: 500 })).toHaveAttribute("href", "/auctions/auction-1");
  expect(screen.getByText("이전 문서")).toBeVisible();
  expect(screen.queryByRole("link", { name: "이전 문서" })).not.toBeInTheDocument();
});
