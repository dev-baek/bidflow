import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ApiError, type ApiClient } from "../../shared/api/api-client";
import { AuctionDetailPage } from "./AuctionDetailPage";

const detail = { auctionId: "auction-1", title: "카메라", thumbnailObjectKey: "products/camera.jpg", currentPrice: 21_000, endsAt: "2030-01-01T12:00:00Z", status: "ACTIVE" as const, auctionVersion: 2, outcome: null, finalPrice: null };

describe("AuctionDetailPage", () => {
  it("renders the PostgreSQL snapshot after its loading state", async () => {
    const client: ApiClient = { get: async <T,>() => detail as T };
    render(<AuctionDetailPage auctionId="auction-1" apiBaseUrl="http://api" client={client} />);
    expect(screen.getByRole("status")).toHaveTextContent("불러오는 중");
    expect(await screen.findByRole("heading", { name: "카메라" })).toBeInTheDocument();
    expect(screen.getByText("21,000원")).toBeInTheDocument();
  });

  it("shows a distinct not-found state", async () => {
    const client: ApiClient = { get: async () => { throw new ApiError(404); } };
    render(<AuctionDetailPage auctionId="missing" apiBaseUrl="http://api" client={client} />);
    await waitFor(() => expect(screen.getByRole("heading", { name: "경매를 찾을 수 없습니다" })).toBeInTheDocument());
  });
});
