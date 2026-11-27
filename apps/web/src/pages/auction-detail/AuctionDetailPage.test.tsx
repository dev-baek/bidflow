import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, type ApiClient } from "../../shared/api/api-client";
import { AuctionDetailPage } from "./AuctionDetailPage";

const detail = { auctionId: "auction-1", title: "카메라", hasThumbnail: false, currentPrice: 21_000, endsAt: "2030-01-01T12:00:00Z", status: "ACTIVE" as const, auctionVersion: 2, outcome: null, finalPrice: null };
const sold = { ...detail, status: "ENDED", outcome: "SOLD", finalPrice: 21_000 } as const;
const outcomePath = "/api/v1/me/auctions/auction-1/outcome";
const baseProps = { auctionId: detail.auctionId, apiBaseUrl: "http://api", wsBaseUrl: "ws://api" };

vi.mock("../../features/auction-realtime/auction-realtime-client", () => ({
  subscribeAuctionUpdates: () => () => {},
}));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("AuctionDetailPage", () => {
  it("renders ordered public photos and falls back for an individual missing photo", async () => {
    const get = vi.fn()
      .mockResolvedValueOnce({ ...detail, hasThumbnail: true })
      .mockResolvedValueOnce({ imageIds: ["front", "back"] });
    render(<AuctionDetailPage {...baseProps} client={{ get, post: vi.fn() }} />);
    const first = await screen.findByRole("img", { name: "카메라 사진 1" });
    expect(first).toHaveAttribute("src", "http://api/api/v1/auctions/auction-1/images/front");
    expect(get).toHaveBeenLastCalledWith("/api/v1/auctions/auction-1/images");
    fireEvent.error(first);
    expect(screen.getByText("사진을 불러오지 못했어요.")).toBeVisible();
    const next = screen.getByRole("button", { name: "사진 2 보기" });
    fireEvent.click(next);
    expect(next).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("img", { name: "카메라 사진 2" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "카메라" })).toBeVisible();
  });

  it("does not show a bid form for cancelled auctions or guess an unpublished outcome", async () => {
    for (const [status, message] of [["CANCELLED", "취소된 경매입니다."], ["ENDED", "경매 결과를 확인 중입니다."]] as const) {
      const client = { get: vi.fn().mockResolvedValue({ ...detail, status }), post: vi.fn() };
      const view = render(<AuctionDetailPage {...baseProps} localActorId="bidder-a" client={client} />);
      expect(await screen.findByText(message)).toBeVisible();
      expect(screen.queryByRole("form", { name: "입찰 요청" })).not.toBeInTheDocument();
      expect(screen.queryByText("유찰", { exact: true })).not.toBeInTheDocument();
      view.unmount();
    }
  });

  it("retries an initial public snapshot error", async () => {
    const client = { get: vi.fn().mockRejectedValueOnce(new ApiError(503)).mockResolvedValueOnce(detail), post: vi.fn() };
    render(<AuctionDetailPage {...baseProps} client={client} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("경매 정보를 불러오지 못했습니다.");
    fireEvent.click(screen.getByRole("button", { name: "다시 조회" }));
    expect(await screen.findByRole("heading", { name: "카메라" })).toBeVisible();
  });

  it("keeps the trade panel visible when the photo list fails and retries only the photos", async () => {
    const get = vi.fn().mockResolvedValueOnce({ ...detail, hasThumbnail: true })
      .mockRejectedValueOnce(new ApiError(503)).mockResolvedValueOnce({ imageIds: [] });
    render(<AuctionDetailPage {...baseProps} client={{ get, post: vi.fn() }} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("사진을 조회하지 못했어요.");
    expect(screen.getByText("21,000원")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "사진 다시 조회" }));
    expect(await screen.findByText("사진 없음")).toBeVisible();
    expect(get.mock.calls.map(([path]) => path)).toEqual([
      "/api/v1/auctions/auction-1", "/api/v1/auctions/auction-1/images", "/api/v1/auctions/auction-1/images",
    ]);
  });

  it.each(["ACTIVE", "ENDED"] as const)("keeps the %s snapshot public and authenticates the private action", async (status) => {
    const request = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(status === "ACTIVE" ? detail : sold))
      .mockResolvedValueOnce(Response.json(status === "ACTIVE" ? { bidRequestId: "bid-1", status: "RECEIVED" }
        : { auctionId: "auction-1", outcome: "WON" }));
    vi.stubGlobal("fetch", request);
    render(<AuctionDetailPage {...baseProps} apiBaseUrl="https://api.example.test" wsBaseUrl="wss://api.example.test"
      cognitoAccess={{ token: () => "access-token", unauthorized: vi.fn() }} />);
    if (status === "ACTIVE") {
      fireEvent.change(await screen.findByLabelText("입찰 금액"), { target: { value: "24000" } });
      fireEvent.click(screen.getByRole("button", { name: "입찰 내용 확인" }));
      fireEvent.click(screen.getByRole("button", { name: "입찰 요청" }));
      expect(await screen.findByText(/입찰 요청을 접수했습니다/)).toBeVisible();
    } else {
      expect(await screen.findByText("내가 낙찰받았습니다.")).toBeVisible();
    }
    expect(request).toHaveBeenCalledTimes(2);
    const [publicUrl, publicInit] = request.mock.calls[0]!;
    const [privateUrl, privateInit] = request.mock.calls[1]!;
    expect(publicUrl).toBe("https://api.example.test/api/v1/auctions/auction-1");
    expect(privateUrl).toBe(`https://api.example.test${status === "ACTIVE" ? "/api/v1/auctions/auction-1/bid-requests" : outcomePath}`);
    expect(new Headers(publicInit?.headers).get("Authorization")).toBeNull();
    expect(new Headers(privateInit?.headers).get("Authorization")).toBe("Bearer access-token");
  });

  it("renders the PostgreSQL snapshot after its loading state", async () => {
    const client: ApiClient = { get: async <T,>() => detail as T, post: async <T,>() => detail as T };
    render(<AuctionDetailPage auctionId="auction-1" apiBaseUrl="http://api" wsBaseUrl="ws://api" client={client} />);
    expect(screen.getByRole("status")).toHaveTextContent("불러오는 중");
    expect(await screen.findByRole("heading", { name: "카메라" })).toBeInTheDocument();
    expect(screen.getByText("21,000원")).toBeInTheDocument();
    expect(screen.getByText("진행 중")).toHaveClass("ui-badge");
    expect(screen.getByText(/2030/).closest("time")).toHaveAttribute("datetime", detail.endsAt);
  });

  it("shows a distinct not-found state", async () => {
    const client: ApiClient = { get: async () => { throw new ApiError(404); }, post: async () => { throw new ApiError(404); } };
    render(<AuctionDetailPage auctionId="missing" apiBaseUrl="http://api" wsBaseUrl="ws://api" client={client} />);
    await waitFor(() => expect(screen.getByRole("heading", { name: "경매를 찾을 수 없습니다" })).toBeInTheDocument());
  });

  it("does not load private results for anonymous viewers or auctions that are not sold", async () => {
    for (const [snapshot, actorId] of [[sold, undefined], [detail, "bidder-a"], [{ ...sold, outcome: "UNSOLD" }, "bidder-a"]] as const) {
      const get = vi.fn().mockResolvedValue(snapshot);
      const view = render(<AuctionDetailPage {...baseProps} client={{ get, post: vi.fn() }} localActorId={actorId} />);
      const page = within(view.container);
      expect(await page.findByRole("heading", { name: "카메라" })).toBeVisible();
      expect(page.queryByRole("region", { name: "본인 입찰 결과" })).not.toBeInTheDocument();
      expect(get).toHaveBeenCalledTimes(1);
      view.unmount();
    }
  });

  it("keeps the public price while a private request fails, then retries with the current actor", async () => {
    let rejectLookup!: (reason: unknown) => void;
    const firstResult = new Promise<unknown>((_, reject) => { rejectLookup = reject; });
    const outcome = vi.fn().mockReturnValueOnce(firstResult).mockRejectedValueOnce(new ApiError(401));
    const get = vi.fn((path: string, headers?: Record<string, string>) => path === outcomePath
      ? outcome(headers)
      : Promise.resolve(sold));
    const { container } = render(<AuctionDetailPage {...baseProps} client={{ get, post: vi.fn() }} localActorId="bidder-a" />);
    const page = within(container);

    // Loading can render before the effect subscribes to the request promise.
    await waitFor(() => expect(outcome).toHaveBeenCalledTimes(1));
    expect(page.getByText("본인 결과를 조회하고 있습니다.")).toBeVisible();
    await act(async () => { rejectLookup(new ApiError(503)); });
    expect(await page.findByRole("alert")).toHaveTextContent("본인 결과를 불러오지 못했습니다.");
    expect(page.getByText("낙찰 · 21,000원")).toBeVisible();
    fireEvent.click(page.getByRole("button", { name: "본인 결과 재조회" }));
    expect(await page.findByRole("link", { name: "다시 로그인" })).toHaveAttribute("href", "/login");
    expect(outcome.mock.calls).toEqual([
      [{ "X-Actor-Id": "bidder-a" }],
      [{ "X-Actor-Id": "bidder-a" }],
    ]);
  });

  it("ignores a private result from a previous actor or auction", async () => {
    let resolveOld: (value: unknown) => void = () => {};
    const oldResult = new Promise(resolve => { resolveOld = resolve; });
    const get = vi.fn((path: string, headers?: Record<string, string>) => {
      if (path === outcomePath) {
        return headers?.["X-Actor-Id"] === "bidder-a" ? oldResult
          : Promise.resolve({ auctionId: "auction-1", outcome: "LOST" });
      }
      if (path === "/api/v1/me/auctions/auction-2/outcome") {
        return Promise.resolve({ auctionId: "auction-2", outcome: "NOT_PARTICIPATED" });
      }
      return Promise.resolve(path.endsWith("auction-2") ? { ...sold, auctionId: "auction-2" } : sold);
    });
    const client: ApiClient = { get: <T,>(path: string, headers?: Record<string, string>) => get(path, headers) as Promise<T>, post: vi.fn() };
    const { container, rerender } = render(<AuctionDetailPage {...baseProps} client={client} localActorId="bidder-a" />);
    const page = within(container);

    expect(await page.findByText("본인 결과를 조회하고 있습니다.")).toBeVisible();
    rerender(<AuctionDetailPage {...baseProps} client={client} localActorId="bidder-b" />);
    expect(await page.findByText("패찰했습니다.")).toBeVisible();
    await act(async () => { resolveOld({ auctionId: "auction-1", outcome: "WON" }); });
    expect(page.queryByText("내가 낙찰받았습니다.")).not.toBeInTheDocument();

    rerender(<AuctionDetailPage {...baseProps} auctionId="auction-2" client={client} localActorId="bidder-b" />);
    expect(page.queryByText("패찰했습니다.")).not.toBeInTheDocument();
    expect(await page.findByText("승인된 입찰 내역이 없습니다.")).toBeVisible();
  });
});
