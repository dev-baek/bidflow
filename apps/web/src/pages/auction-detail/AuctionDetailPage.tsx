import { useCallback, useEffect, useMemo, useReducer, useState } from "react";
import { ApiError, createApiClient, createProtectedApiClient, type AccessTokenSource, type ApiClient } from "../../shared/api/api-client";
import { auctionDetailReducer, createAuctionDetailState, type AuctionDetail } from "../../features/auction-detail/auction-detail-state";
import { BidRequestForm } from "./BidRequestForm";
import { PrivateAuctionOutcome } from "./PrivateAuctionOutcome";
import { subscribeAuctionUpdates, type BidResultMessage } from "../../features/auction-realtime/auction-realtime-client";

export type AuctionDetailPageProps = Readonly<{ auctionId: string; apiBaseUrl: string; wsBaseUrl: string; client?: ApiClient; localActorId?: string; cognitoAccess?: AccessTokenSource }>;

export function AuctionDetailPage({ auctionId, apiBaseUrl, wsBaseUrl, client, localActorId, cognitoAccess }: AuctionDetailPageProps) {
  const [state, dispatch] = useReducer(auctionDetailReducer, undefined, createAuctionDetailState);
  const [bidResult, setBidResult] = useState<BidResultMessage>();
  const defaultClient = useMemo(() => createApiClient(apiBaseUrl, fetch), [apiBaseUrl]);
  const resolvedClient = client ?? defaultClient;
  const protectedClient = useMemo(() => cognitoAccess ? createProtectedApiClient(apiBaseUrl, fetch, cognitoAccess)
    : resolvedClient, [apiBaseUrl, cognitoAccess, resolvedClient]);
  const credential = cognitoAccess?.token ?? localActorId;
  const actorId = cognitoAccess ? undefined : localActorId;

  const load = useCallback(() => {
    let active = true;
    resolvedClient.get<AuctionDetail>(`/api/v1/auctions/${auctionId}`)
      .then((detail) => { if (active) dispatch({ type: "SNAPSHOT_LOADED", detail }); })
      .catch((error: unknown) => {
        if (!active) return;
        dispatch(error instanceof ApiError && error.status === 404 ? { type: "NOT_FOUND" } : { type: "LOAD_FAILED" });
      });
    return () => { active = false; };
  }, [auctionId, resolvedClient]);

  useEffect(() => load(), [load]);
  useEffect(() => credential ? subscribeAuctionUpdates(wsBaseUrl, auctionId, credential, () => { load(); }, setBidResult) : undefined,
    [auctionId, load, credential, wsBaseUrl]);

  if (state.mode === "LOADING") return <main className="app-shell"><p role="status">경매 정보를 불러오는 중입니다.</p></main>;
  if (state.mode === "NOT_FOUND") return <main className="app-shell"><section className="message-card"><h1>경매를 찾을 수 없습니다</h1></section></main>;
  if (state.mode === "ERROR") return <main className="app-shell"><section className="message-card"><p role="alert">경매 정보를 불러오지 못했습니다.</p></section></main>;

  const { detail } = state;
  return <main className="app-shell listing-shell"><section className="listing-form" aria-labelledby="auction-detail-title">
    <p className="eyebrow">AUCTION DETAIL</p><h1 id="auction-detail-title">{detail.title}</h1>
    {state.refreshFailed ? <div><p role="alert">최신 경매 상태를 확인하지 못했습니다. 이전 조회 결과를 표시합니다.</p><button type="button" onClick={() => { load(); }}>다시 조회</button></div> : null}
    <dl className="auction-summary"><div><dt>현재가</dt><dd>{detail.currentPrice.toLocaleString()}원</dd></div><div><dt>상태</dt><dd>{detail.status}</dd></div><div><dt>종료 시각</dt><dd><time dateTime={detail.endsAt}>{new Date(detail.endsAt).toLocaleString("ko-KR")}</time></dd></div></dl>
    {detail.thumbnailObjectKey ? <p className="field-help">대표 이미지: {detail.thumbnailObjectKey}</p> : null}
    {detail.status === "ENDED" ? <p role="status">{detail.outcome === "SOLD" ? `낙찰 · ${detail.finalPrice?.toLocaleString()}원` : "유찰"}</p> : credential ? <BidRequestForm key={`${auctionId}:${actorId}`} auctionId={auctionId} actorId={actorId} client={protectedClient} settlement={bidResult?.auctionId === auctionId ? bidResult : undefined} /> : <p className="field-help"><a href="/login">로그인</a> 후 입찰할 수 있습니다.</p>}
    {credential && detail.auctionId === auctionId && detail.status === "ENDED" && detail.outcome === "SOLD"
      ? <PrivateAuctionOutcome key={`${auctionId}:${actorId}`} auctionId={auctionId} actorId={actorId} client={protectedClient} />
      : null}
  </section></main>;
}
