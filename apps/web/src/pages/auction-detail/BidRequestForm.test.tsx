import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../../shared/api/api-client";
import { BidRequestForm } from "./BidRequestForm";

afterEach(cleanup);

describe("BidRequestForm", () => {
  it.each([true, false])("labels an approved result as a past processing-time fact (highest=%s)", async (isHighestBidder) => {
    const client: ApiClient = { get: async <T,>() => ({} as T),
      post: async <T,>() => ({ bidRequestId: "request-1", status: "RECEIVED" } as T) };
    const { container, rerender } = render(<BidRequestForm auctionId="auction-1" actorId="bidder" client={client} />);
    const form = within(container);
    fireEvent.change(form.getByLabelText("입찰 금액"), { target: { value: "12000" } });
    fireEvent.click(form.getByRole("button", { name: "입찰 요청" }));
    await form.findByText(/요청 번호: request-1/);
    rerender(<BidRequestForm auctionId="auction-1" actorId="bidder" client={client}
      settlement={{ bidRequestId: "request-1", decision: "ACCEPTED", isHighestBidder }} />);
    await waitFor(() => expect(form.getByRole("status")).toHaveTextContent(isHighestBidder
      ? "입찰이 승인되었습니다. 이 요청 처리 당시 최고 입찰자였습니다."
      : "입찰이 승인되었습니다. 이 요청 처리 당시 최고 입찰자가 아니었습니다."));
    expect(form.queryByText(/현재 최고 입찰자/)).not.toBeInTheDocument();
  });

  it("never describes a rejected request as an approval even if the flag is true", async () => {
    const client: ApiClient = { get: async <T,>() => ({} as T),
      post: async <T,>() => ({ bidRequestId: "rejected", status: "RECEIVED" } as T) };
    const { container, rerender } = render(<BidRequestForm auctionId="auction-1" actorId="bidder" client={client} />);
    const form = within(container);
    fireEvent.change(form.getByLabelText("입찰 금액"), { target: { value: "12000" } });
    fireEvent.click(form.getByRole("button", { name: "입찰 요청" }));
    await form.findByText(/요청 번호: rejected/);
    rerender(<BidRequestForm auctionId="auction-1" actorId="bidder" client={client}
      settlement={{ bidRequestId: "rejected", decision: "REJECTED", isHighestBidder: true }} />);
    expect(await form.findByRole("alert")).toHaveTextContent("입찰이 거절되었습니다.");
    expect(form.queryByText(/입찰이 승인되었습니다|처리 당시|현재 최고 입찰자/)).not.toBeInTheDocument();
  });

  it("clears the previous approval on editing and ignores that request while awaiting a new result", async () => {
    const post = vi.fn().mockResolvedValueOnce({ bidRequestId: "old", status: "RECEIVED" })
      .mockResolvedValueOnce({ bidRequestId: "new", status: "RECEIVED" });
    const client: ApiClient = { get: async <T,>() => ({} as T), post };
    const { container, rerender } = render(<BidRequestForm auctionId="auction-1" actorId="bidder" client={client} />);
    const form = within(container);
    const result = (id: string) => <BidRequestForm auctionId="auction-1" actorId="bidder" client={client}
      settlement={{ bidRequestId: id, decision: "ACCEPTED", isHighestBidder: true }} />;
    fireEvent.change(form.getByLabelText("입찰 금액"), { target: { value: "11000" } });
    fireEvent.click(form.getByRole("button", { name: "입찰 요청" }));
    await form.findByText(/요청 번호: old/);
    rerender(result("old"));
    await form.findByText(/입찰이 승인되었습니다/);
    fireEvent.change(form.getByLabelText("입찰 금액"), { target: { value: "13000" } });
    expect(form.queryByText(/입찰이 승인되었습니다/)).not.toBeInTheDocument();
    fireEvent.click(form.getByRole("button", { name: "입찰 요청" }));
    await form.findByText(/요청 번호: new/);
    rerender(result("old"));
    expect(form.queryByText(/입찰이 승인되었습니다/)).not.toBeInTheDocument();
    rerender(result("new"));
    await form.findByText(/입찰이 승인되었습니다/);
  });
  it("sends an asynchronous direct bid request and shows only its receipt", async () => {
    let receivedRequest: readonly unknown[] = [];
    const post: ApiClient["post"] = async <T,>(path: string, body: unknown, headers?: Record<string, string>) => {
      receivedRequest = [path, body, headers];
      return { bidRequestId: "request-1", status: "RECEIVED" } as T;
    };
    const client: ApiClient = { get: async <T,>() => ({} as T), post };
    render(<BidRequestForm auctionId="auction-1" actorId="local-bidder" client={client} />);

    fireEvent.change(screen.getByLabelText("입찰 금액"), { target: { value: "21000" } });
    fireEvent.click(screen.getByRole("button", { name: "입찰 요청" }));

    await waitFor(() => expect(receivedRequest).not.toEqual([]));
    expect(receivedRequest[0]).toBe("/api/v1/auctions/auction-1/bid-requests");
    expect(receivedRequest[1]).toEqual({ bidKind: "DIRECT", amount: 21000 });
    expect(receivedRequest[2]).toMatchObject({ "X-Actor-Id": "local-bidder" });
    expect(await screen.findByRole("status")).toHaveTextContent("요청 번호: request-1");
  });

  it("shows only the matching private settlement result", async () => {
    const client: ApiClient = {
      get: async <T,>() => ({} as T),
      post: async <T,>() => ({ bidRequestId: "request-1", status: "RECEIVED" } as T),
    };
    const { rerender, container } = render(<BidRequestForm auctionId="auction-1" actorId="local-bidder" client={client} />);
    const form = within(container);

    fireEvent.change(form.getByLabelText("입찰 금액"), { target: { value: "21000" } });
    fireEvent.click(form.getByRole("button", { name: "입찰 요청" }));
    await waitFor(() => expect(form.getByRole("status")).toHaveTextContent("요청 번호: request-1"));
    rerender(<BidRequestForm auctionId="auction-1" actorId="local-bidder" client={client}
      settlement={{ bidRequestId: "request-1", decision: "ACCEPTED", isHighestBidder: false }} />);

    expect(await form.findByText("입찰이 승인되었습니다. 이 요청 처리 당시 최고 입찰자가 아니었습니다.")).toBeVisible();
  });

  it("reuses a key after a lost receipt but allocates a new key after successful receipt", async () => {
    const post = vi.fn()
      .mockRejectedValueOnce(new TypeError("response lost"))
      .mockResolvedValueOnce({ bidRequestId: "request-1", status: "RECEIVED" })
      .mockResolvedValueOnce({ bidRequestId: "request-2", status: "RECEIVED" });
    const client: ApiClient = { get: async <T,>() => ({} as T), post };
    const { container, rerender } = render(<BidRequestForm auctionId="auction-1" actorId="local-bidder" client={client} />);
    const form = within(container);
    const submit = () => fireEvent.click(form.getByRole("button", { name: "입찰 요청" }));
    const key = (index: number) => post.mock.calls[index]?.[2]["Idempotency-Key"];

    fireEvent.change(form.getByLabelText("입찰 금액"), { target: { value: "12000" } });
    submit();
    expect(await form.findByRole("alert")).toBeVisible();
    rerender(<BidRequestForm auctionId="auction-1" actorId="local-bidder" client={client}
      settlement={{ bidRequestId: "request-1", decision: "ACCEPTED", isHighestBidder: true }} />);
    submit();
    expect(await form.findByText(/입찰이 승인되었습니다/)).toBeVisible();
    expect(key(0)).toBeTruthy();
    expect(key(1)).toBe(key(0));

    submit();
    expect(await form.findByText(/요청 번호: request-2/)).toBeVisible();
    expect(key(2)).toBeTruthy();
    expect(key(2)).not.toBe(key(0));
  });
});
