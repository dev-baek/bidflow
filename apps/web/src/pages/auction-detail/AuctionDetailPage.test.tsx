import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ApiError, type ApiClient } from "../../shared/api/api-client";
import { AuctionDetailPage } from "./AuctionDetailPage";

const detail = { auctionId: "auction-1", title: "카메라", thumbnailObjectKey: "products/camera.jpg", currentPrice: 21_000, endsAt: "2030-01-01T12:00:00Z", status: "ACTIVE" as const, auctionVersion: 2, outcome: null, finalPrice: null };
const sold = { ...detail, status: "ENDED", outcome: "SOLD", finalPrice: 21_000 } as const;
const outcomePath = "/api/v1/me/auctions/auction-1/outcome";
const baseProps = { auctionId: detail.auctionId, apiBaseUrl: "http://api", wsBaseUrl: "ws://api" };

vi.mock("../../features/auction-realtime/auction-realtime-client", () => ({
  subscribeAuctionUpdates: () => () => {},
}));

describe("AuctionDetailPage", () => {
  it("renders the PostgreSQL snapshot after its loading state", async () => {
    const client: ApiClient = { get: async <T,>() => detail as T, post: async <T,>() => detail as T };
    render(<AuctionDetailPage auctionId="auction-1" apiBaseUrl="http://api" wsBaseUrl="ws://api" client={client} />);
    expect(screen.getByRole("status")).toHaveTextContent("불러오는 중");
    expect(await screen.findByRole("heading", { name: "카메라" })).toBeInTheDocument();
    expect(screen.getByText("21,000원")).toBeInTheDocument();
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
    let rejectLookup: (reason: unknown) => void = () => {};
    const firstResult = new Promise((_, reject) => { rejectLookup = reject; });
    const outcome = vi.fn().mockReturnValueOnce(firstResult).mockRejectedValueOnce(new ApiError(401));
    const get = vi.fn((path: string, headers?: Record<string, string>) => path === outcomePath
      ? outcome(headers)
      : Promise.resolve(sold));
    const { container } = render(<AuctionDetailPage {...baseProps} client={{ get, post: vi.fn() }} localActorId="bidder-a" />);
    const page = within(container);

    expect(await page.findByText("본인 결과를 조회하고 있습니다.")).toBeVisible();
    await act(async () => { rejectLookup(new ApiError(503)); });
    expect(await page.findByRole("alert")).toHaveTextContent("본인 결과를 불러오지 못했습니다.");
    expect(page.getByText("낙찰 · 21,000원")).toBeVisible();
    fireEvent.click(page.getByRole("button", { name: "본인 결과 재조회" }));
    expect(await page.findByRole("link", { name: "다시 로그인" })).toHaveAttribute("href", "/login");
    expect(get).toHaveBeenCalledWith(outcomePath, { "X-Actor-Id": "bidder-a" });
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
