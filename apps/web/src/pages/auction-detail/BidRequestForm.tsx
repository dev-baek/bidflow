import { useEffect, useReducer, useRef, type FormEvent } from "react";
import { bidRequestReducer, createBidRequestState, type BidSettlement } from "../../features/bid-request/bid-request-state";
import { type ApiClient } from "../../shared/api/api-client";

type BidResponse = Readonly<{ bidRequestId: string; status: "RECEIVED" }>;
export type BidRequestFormProps = Readonly<{ auctionId: string; actorId?: string; client: ApiClient; settlement?: BidSettlement }>;

export function BidRequestForm({ auctionId, actorId, client, settlement }: BidRequestFormProps) {
  const [state, dispatch] = useReducer(bidRequestReducer, undefined, createBidRequestState);
  const idempotencyKey = useRef<string | undefined>(undefined);
  useEffect(() => { if (settlement) dispatch({ type: "SETTLED", settlement }); }, [settlement]);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (state.mode === "SUBMITTING") return;
    const amount = Number(state.amount);
    if (!Number.isSafeInteger(amount) || amount < 1000) { dispatch({ type: "FAILED" }); return; }
    const retry = idempotencyKey.current !== undefined;
    const key = idempotencyKey.current ??= globalThis.crypto.randomUUID();
    dispatch({ type: "SUBMIT_REQUESTED", retry });
    void client.post<BidResponse>(`/api/v1/auctions/${auctionId}/bid-requests`, { bidKind: state.kind, amount }, {
      "Idempotency-Key": key, ...(actorId ? { "X-Actor-Id": actorId } : {}),
    }).then((response) => {
      idempotencyKey.current = undefined;
      dispatch({ type: "RECEIVED", bidRequestId: response.bidRequestId });
    })
      .catch(() => dispatch({ type: "FAILED" }));
  };
  return <form className="bid-request-form" onSubmit={submit} aria-label="입찰 요청">
    <label>입찰 방식<select aria-label="입찰 방식" value={state.kind} disabled={state.mode === "SUBMITTING"} onChange={(event) => { idempotencyKey.current = undefined; dispatch({ type: "KIND_CHANGED", kind: event.target.value as "DIRECT" | "AUTO_MAX" }); }}><option value="DIRECT">직접 입찰</option><option value="AUTO_MAX">자동 입찰 최대가</option></select></label>
    <label>금액<input aria-label="입찰 금액" type="number" min="1000" step="1" value={state.amount} disabled={state.mode === "SUBMITTING"} onChange={(event) => { idempotencyKey.current = undefined; dispatch({ type: "AMOUNT_CHANGED", amount: event.target.value }); }} /></label>
    {state.mode === "RECEIVED" ? <p role="status">입찰 요청을 접수했습니다. 요청 번호: {state.bidRequestId}</p> : null}
    {state.mode === "SETTLED" && state.settlement?.decision === "ACCEPTED" ? <p role="status">입찰이 승인되었습니다. {state.settlement.isHighestBidder ? "이 요청 처리 당시 최고 입찰자였습니다." : "이 요청 처리 당시 최고 입찰자가 아니었습니다."}</p> : null}
    {state.mode === "SETTLED" && state.settlement?.decision === "REJECTED" ? <p role="alert">입찰이 거절되었습니다.</p> : null}
    {state.mode === "ERROR" ? <p role="alert">입찰 요청을 접수하지 못했습니다. 금액을 확인하거나 다시 시도하세요.</p> : null}
    <button type="submit" disabled={state.mode === "SUBMITTING"}>입찰 요청</button>
  </form>;
}
