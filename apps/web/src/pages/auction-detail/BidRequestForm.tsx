import { useEffect, useReducer, useRef, type FormEvent } from "react";
import { bidRequestReducer, createBidRequestState, parseBidAmount, type BidSettlement, type BidKind } from "../../features/bid-request/bid-request-state";
import { type ApiClient } from "../../shared/api/api-client";
import { Button } from "../../shared/ui/Button";
import { Field } from "../../shared/ui/Field";
import { StatusMessage } from "../../shared/ui/Feedback";

type BidResponse = Readonly<{ bidRequestId: string; status: "RECEIVED" }>;
export type BidRequestFormProps = Readonly<{ auctionId: string; actorId?: string; client: ApiClient; settlement?: BidSettlement }>;

const kinds = { DIRECT: "직접 입찰", AUTO_MAX: "자동 입찰 최대가" } satisfies Record<BidKind, string>;
const rejectionReasons: Readonly<Record<string, string>> = {
  BID_TOO_LOW: "입찰 금액이 낮습니다. 현재가를 확인해 주세요.",
  SELF_BID: "본인이 등록한 경매에는 입찰할 수 없습니다.",
  AUCTION_NOT_STARTED: "아직 시작하지 않은 경매입니다.",
  AUCTION_ENDED: "이미 마감된 경매입니다.",
  NOT_ACTIVE: "현재 입찰할 수 없는 경매입니다.",
};

export function BidRequestForm({ auctionId, actorId, client, settlement }: BidRequestFormProps) {
  const [state, dispatch] = useReducer(bidRequestReducer, undefined, createBidRequestState);
  const idempotencyKey = useRef<string | undefined>(undefined);
  const inFlight = useRef(false);
  const amountInput = useRef<HTMLInputElement>(null);
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  const refocusAmount = useRef(false);
  const reviewing = state.mode === "REVIEW";
  const submitting = state.mode === "SUBMITTING";
  const amount = parseBidAmount(state.amount);
  useEffect(() => { if (settlement) dispatch({ type: "SETTLED", settlement }); }, [settlement]);
  useEffect(() => {
    if (state.mode === "REVIEW") reviewHeading.current?.focus();
    else if (state.mode === "INVALID" || refocusAmount.current) {
      refocusAmount.current = false;
      amountInput.current?.focus();
    }
  }, [state.mode]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (inFlight.current) return;
    if (!reviewing || amount === undefined) {
      dispatch({ type: "REVIEW_REQUESTED" });
      if (state.mode === "INVALID") amountInput.current?.focus();
      return;
    }
    inFlight.current = true;
    const retry = idempotencyKey.current !== undefined;
    const key = idempotencyKey.current ??= globalThis.crypto.randomUUID();
    dispatch({ type: "SUBMIT_REQUESTED", retry });
    void client.post<BidResponse>(`/api/v1/auctions/${encodeURIComponent(auctionId)}/bid-requests`, { bidKind: state.kind, amount }, {
      "Idempotency-Key": key, ...(actorId ? { "X-Actor-Id": actorId } : {}),
    }).then((response) => {
      idempotencyKey.current = undefined;
      dispatch({ type: "RECEIVED", bidRequestId: response.bidRequestId });
    })
      .catch(() => dispatch({ type: "FAILED" }))
      .finally(() => { inFlight.current = false; });
  };
  const reason = state.settlement?.reason;
  const rejection = reason && Object.hasOwn(rejectionReasons, reason) ? rejectionReasons[reason] : "";
  return <form className="bid-request-form" onSubmit={submit} aria-label="입찰 요청" noValidate>
    <fieldset className="bid-request-form__fields" disabled={reviewing || submitting}>
      <legend>입찰하기</legend>
      <Field id="bid-kind" label="입찰 방식">
        {control => <select {...control} value={state.kind} onChange={event => {
          idempotencyKey.current = undefined;
          dispatch({ type: "KIND_CHANGED", kind: event.target.value as BidKind });
        }}>
          {Object.entries(kinds).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>}
      </Field>
      <Field id="bid-amount" label="입찰 금액" error={state.mode === "INVALID" ? "입찰 금액은 1,000원 이상의 정수로 입력하세요." : undefined}
        description={state.kind === "AUTO_MAX" ? "자동 입찰에 사용할 최대 한도예요." : undefined}>
        {control => <input {...control} ref={amountInput} inputMode="numeric" value={state.amount} onChange={event => {
          idempotencyKey.current = undefined;
          dispatch({ type: "AMOUNT_CHANGED", amount: event.target.value });
        }} />}
      </Field>
    </fieldset>
    {(reviewing || submitting) && <section className="bid-request-form__review" aria-labelledby="bid-review-title">
      <h3 id="bid-review-title" tabIndex={-1} ref={reviewHeading}>제출할 입찰</h3>
      <p>{kinds[state.kind]} · <strong>{amount?.toLocaleString("ko-KR")}원</strong></p>
      <p>{state.kind === "AUTO_MAX" ? "입력한 한도와 실제 현재가는 다를 수 있어요." : "입력한 금액 그대로 직접 입찰을 요청해요."}</p>
    </section>}
    {state.mode === "RECEIVED" &&
      <StatusMessage kind="loading">{`입찰 요청을 접수했습니다. 요청 번호: ${state.bidRequestId} · 아직 입찰 결과가 확정되지 않았어요.`}</StatusMessage>}
    {state.mode === "SETTLED" && state.settlement?.decision === "ACCEPTED" &&
      <StatusMessage kind="success">{`입찰이 승인되었습니다. ${state.settlement.isHighestBidder ? "이 요청 처리 당시 최고 입찰자였습니다." : "이 요청 처리 당시 최고 입찰자가 아니었습니다."}`}</StatusMessage>}
    {state.mode === "SETTLED" && state.settlement?.decision === "REJECTED" &&
      <StatusMessage kind="error">{`입찰이 거절되었습니다.${rejection ? ` ${rejection}` : ""}`}</StatusMessage>}
    {state.mode === "ERROR" && <StatusMessage kind="error">입찰 요청의 접수 여부를 확인하지 못했어요. 같은 내용으로 다시 시도할 수 있습니다.</StatusMessage>}
    <div className="bid-request-form__buttons">
      {reviewing && <Button variant="secondary" onClick={() => { refocusAmount.current = true; dispatch({ type: "REVIEW_CANCELLED" }); }}>수정하기</Button>}
      <Button type="submit" pendingLabel={submitting ? "요청 보내는 중…" : undefined}>{reviewing ? "입찰 요청" : "입찰 내용 확인"}</Button>
    </div>
  </form>;
}
