import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { ApiError, createApiClient, createProtectedApiClient, joinApiUrl, type AccessTokenSource, type ApiClient } from "../../shared/api/api-client";
import { auctionDetailReducer, createAuctionDetailState, type AuctionDetail } from "../../features/auction-detail/auction-detail-state";
import { BidRequestForm } from "./BidRequestForm";
import { PrivateAuctionOutcome } from "./PrivateAuctionOutcome";
import { subscribeAuctionUpdates, type BidResultMessage } from "../../features/auction-realtime/auction-realtime-client";
import { Badge, StatusMessage, type FeedbackTone } from "../../shared/ui/Feedback";
import { AuctionPhoto } from "../../shared/ui/AuctionPhoto";
import { Button } from "../../shared/ui/Button";
import { PageLayout } from "../../shared/ui/PageLayout";
import { remainingTime } from "../../shared/auction-time";

export type AuctionDetailPageProps = Readonly<{ auctionId: string; apiBaseUrl: string; wsBaseUrl: string; client?: ApiClient; localActorId?: string; cognitoAccess?: AccessTokenSource }>;

const auctionStatus = {
  SCHEDULED: { text: "시작 전", tone: "info" },
  ACTIVE: { text: "진행 중", tone: "success" },
  ENDED: { text: "종료", tone: "neutral" },
  CANCELLED: { text: "취소", tone: "warning" },
} satisfies Record<AuctionDetail["status"], { text: string; tone: FeedbackTone }>;

const deadlineFormat = new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC", hourCycle: "h23" });

export function AuctionDetailPage(props: AuctionDetailPageProps) {
  return <AuctionDetailContent key={props.auctionId} {...props} />;
}

function AuctionDetailContent({ auctionId, apiBaseUrl, wsBaseUrl, client, localActorId, cognitoAccess }: AuctionDetailPageProps) {
  const [state, dispatch] = useReducer(auctionDetailReducer, undefined, createAuctionDetailState);
  const [bidResult, setBidResult] = useState<BidResultMessage>();
  const [reconnecting, setReconnecting] = useState(false);
  const request = useRef(0);
  const defaultClient = useMemo(() => createApiClient(apiBaseUrl, fetch), [apiBaseUrl]);
  const resolvedClient = client ?? defaultClient;
  const protectedClient = useMemo(() => cognitoAccess ? createProtectedApiClient(apiBaseUrl, fetch, cognitoAccess)
    : resolvedClient, [apiBaseUrl, cognitoAccess, resolvedClient]);
  const credential = cognitoAccess?.token ?? localActorId;
  const actorId = cognitoAccess ? undefined : localActorId;

  const load = useCallback(() => {
    const sequence = ++request.current;
    resolvedClient.get<AuctionDetail>(`/api/v1/auctions/${encodeURIComponent(auctionId)}`)
      .then((detail) => {
        if (request.current !== sequence) return;
        dispatch(detail.auctionId === auctionId ? { type: "SNAPSHOT_LOADED", detail } : { type: "LOAD_FAILED" });
      })
      .catch((error: unknown) => {
        if (request.current !== sequence) return;
        dispatch(error instanceof ApiError && error.status === 404 ? { type: "NOT_FOUND" } : { type: "LOAD_FAILED" });
      });
  }, [auctionId, resolvedClient]);

  useEffect(() => {
    load();
    return () => { request.current += 1; };
  }, [load]);
  useEffect(() => {
    setReconnecting(false);
    setBidResult(undefined);
    if (credential) return subscribeAuctionUpdates(wsBaseUrl, auctionId, credential, load, setBidResult, setReconnecting);
  }, [auctionId, load, credential, wsBaseUrl]);

  if (state.mode !== "READY") return <PageLayout width="form">
    {state.mode === "LOADING" && <StatusMessage kind="loading">경매 정보를 불러오는 중입니다.</StatusMessage>}
    {state.mode === "NOT_FOUND" && <section className="auction-detail-message">
      <h1>경매를 찾을 수 없습니다</h1>
      <a className="ui-button ui-button--secondary ui-button--md" href="/listings">경매 목록 보기</a>
    </section>}
    {state.mode === "ERROR" && <section className="auction-detail-message">
      <StatusMessage kind="error">경매 정보를 불러오지 못했습니다.</StatusMessage>
      <Button variant="secondary" onClick={load}>다시 조회</Button>
    </section>}
  </PageLayout>;

  const { detail } = state;
  const status = auctionStatus[detail.status];
  const outcome = detail.outcome === "SOLD" && detail.finalPrice !== null
    ? `낙찰 · ${detail.finalPrice.toLocaleString("ko-KR")}원`
    : detail.outcome === "UNSOLD" ? "유찰" : "경매 결과를 확인 중입니다.";
  return <PageLayout><section className="auction-detail" aria-labelledby="auction-detail-title">
    <h1 id="auction-detail-title">{detail.title}</h1>
    <div className="auction-detail__workspace">
      {detail.hasThumbnail
        ? <AuctionPhotos detail={detail} client={resolvedClient} apiBaseUrl={apiBaseUrl} />
        : <div className="auction-detail__gallery"><AuctionPhoto alt={detail.title} /></div>}
      <section className="auction-detail__trade" aria-label="경매 정보">
        <dl className="auction-summary">
          <div><dt>현재가</dt><dd className="auction-detail__price">{detail.currentPrice.toLocaleString("ko-KR")}원</dd></div>
          <div><dt>경매 상태</dt><dd data-auction-status={detail.status}><Badge tone={status?.tone}>{status?.text ?? "상태 확인 불가"}</Badge></dd></div>
          <div><dt>마감 시각</dt><dd><AuctionDeadline endsAt={detail.endsAt} showRemaining={detail.status === "ACTIVE" || detail.status === "SCHEDULED"} /></dd></div>
        </dl>
        {credential && reconnecting && <StatusMessage kind="warning">실시간 연결을 다시 시도하고 있어요.</StatusMessage>}
        {state.refreshFailed && <div className="auction-detail-message">
          <StatusMessage kind="error">최신 경매 상태를 확인하지 못했습니다. 이전 조회 결과를 표시합니다.</StatusMessage>
          <Button variant="secondary" onClick={load}>다시 조회</Button>
        </div>}
        <div className="auction-detail__actions">
          {detail.status === "ENDED" ? <StatusMessage kind={detail.outcome === "SOLD" ? "success" : "empty"}>{outcome}</StatusMessage>
            : detail.status === "CANCELLED" ? <StatusMessage kind="warning">취소된 경매입니다.</StatusMessage>
            : credential ? <BidRequestForm key={actorId} auctionId={auctionId} actorId={actorId} client={protectedClient} settlement={bidResult} />
            : <a className="ui-button ui-button--primary ui-button--md" href="/login">로그인하고 입찰하기</a>}
          {credential && detail.status === "ENDED" && detail.outcome === "SOLD" &&
            <PrivateAuctionOutcome key={actorId} auctionId={auctionId} actorId={actorId} client={protectedClient} />}
        </div>
      </section>
    </div>
  </section></PageLayout>;
}

function AuctionDeadline({ endsAt, showRemaining }: Readonly<{ endsAt: string; showRemaining: boolean }>) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!showRemaining) return;
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [showRemaining]);
  const deadline = Date.parse(endsAt);
  const remaining = showRemaining ? remainingTime(deadline, now) : undefined;
  return <>
    {remaining && <strong>{deadline > now ? `남은 시간 ${remaining}` : remaining}</strong>}
    {Number.isFinite(deadline) ? <time dateTime={endsAt}>{deadlineFormat.format(deadline)} UTC</time> : <span>마감 시각 확인 불가</span>}
  </>;
}

function AuctionPhotos({ detail, client, apiBaseUrl }: Readonly<{ detail: AuctionDetail; client: ApiClient; apiBaseUrl: string }>) {
  const [ids, setIds] = useState<readonly string[]>();
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [selected, setSelected] = useState(0);
  const path = `/api/v1/auctions/${encodeURIComponent(detail.auctionId)}/images`;
  useEffect(() => {
    let active = true;
    client.get<{ imageIds: string[] }>(path)
      .then(({ imageIds }) => { if (active) setIds(imageIds); })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [attempt, client, path]);

  const src = (id: string) => joinApiUrl(apiBaseUrl, `${path}/${encodeURIComponent(id)}`);
  const shown = ids?.[selected];
  return <section aria-label="출품 사진" className="auction-detail__gallery">
    {failed ? <div className="auction-photo auction-detail__photo-message">
      <StatusMessage kind="error">사진을 조회하지 못했어요.</StatusMessage>
      <Button variant="secondary" onClick={() => { setFailed(false); setAttempt(attempt + 1); }}>사진 다시 조회</Button>
    </div> : !ids ? <div className="auction-photo"><span>사진을 불러오는 중이에요.</span></div>
      : <AuctionPhoto key={shown} src={shown ? src(shown) : undefined} alt={`${detail.title} 사진 ${selected + 1}`}
          failureText="사진을 불러오지 못했어요." />}
    {ids && ids.length > 1 && <div className="auction-detail__thumbs" role="group" aria-label="상품 사진 선택">
      {ids.map((id, index) => <button key={id} type="button" aria-label={`사진 ${index + 1} 보기`}
        aria-pressed={index === selected} onClick={() => setSelected(index)}>
        <AuctionPhoto src={src(id)} alt="" failureText="—" />
      </button>)}
    </div>}
  </section>;
}
