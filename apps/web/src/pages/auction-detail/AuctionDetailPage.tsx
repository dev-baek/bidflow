import { useEffect, useMemo, useReducer } from "react";
import { ApiError, createApiClient, type ApiClient } from "../../shared/api/api-client";
import { auctionDetailReducer, createAuctionDetailState, type AuctionDetail } from "../../features/auction-detail/auction-detail-state";
import { BidRequestForm } from "./BidRequestForm";

export type AuctionDetailPageProps = Readonly<{ auctionId: string; apiBaseUrl: string; client?: ApiClient; localActorId?: string }>;

export function AuctionDetailPage({ auctionId, apiBaseUrl, client, localActorId }: AuctionDetailPageProps) {
  const [state, dispatch] = useReducer(auctionDetailReducer, undefined, createAuctionDetailState);
  const defaultClient = useMemo(() => createApiClient(apiBaseUrl, fetch), [apiBaseUrl]);
  const resolvedClient = client ?? defaultClient;

  useEffect(() => {
    let active = true;
    resolvedClient.get<AuctionDetail>(`/api/v1/auctions/${auctionId}`)
      .then((detail) => { if (active) dispatch({ type: "SNAPSHOT_LOADED", detail }); })
      .catch((error: unknown) => {
        if (!active) return;
        dispatch(error instanceof ApiError && error.status === 404 ? { type: "NOT_FOUND" } : { type: "LOAD_FAILED" });
      });
    return () => { active = false; };
  }, [auctionId, resolvedClient]);

  if (state.mode === "LOADING") return <main className="app-shell"><p role="status">경매 정보를 불러오는 중입니다.</p></main>;
  if (state.mode === "NOT_FOUND") return <main className="app-shell"><section className="message-card"><h1>경매를 찾을 수 없습니다</h1></section></main>;
  if (state.mode === "ERROR") return <main className="app-shell"><section className="message-card"><p role="alert">경매 정보를 불러오지 못했습니다.</p></section></main>;

  const { detail } = state;
  return <main className="app-shell listing-shell"><section className="listing-form" aria-labelledby="auction-detail-title">
    <p className="eyebrow">AUCTION DETAIL</p><h1 id="auction-detail-title">{detail.title}</h1>
    <dl className="auction-summary"><div><dt>현재가</dt><dd>{detail.currentPrice.toLocaleString()}원</dd></div><div><dt>상태</dt><dd>{detail.status}</dd></div><div><dt>종료 시각</dt><dd>{new Date(detail.endsAt).toLocaleString("ko-KR")}</dd></div></dl>
    {detail.thumbnailObjectKey ? <p className="field-help">대표 이미지: {detail.thumbnailObjectKey}</p> : null}
    {detail.status === "ENDED" ? <p role="status">{detail.outcome === "SOLD" ? `낙찰 · ${detail.finalPrice?.toLocaleString()}원` : "유찰"}</p> : localActorId ? <BidRequestForm auctionId={auctionId} actorId={localActorId} client={resolvedClient} /> : <p className="field-help"><a href="/login">로그인</a> 후 입찰할 수 있습니다.</p>}
  </section></main>;
}
