import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, it, vi } from "vitest";
import { ListingSearchPage } from "./ListingSearchPage";

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
