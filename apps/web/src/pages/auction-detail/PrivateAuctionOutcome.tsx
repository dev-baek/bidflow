import { useEffect, useState } from "react";
import { ApiError, type ApiClient } from "../../shared/api/api-client";
import { Button } from "../../shared/ui/Button";
import { StatusMessage } from "../../shared/ui/Feedback";

const messages = {
  WON: "내가 낙찰받았습니다.",
  LOST: "패찰했습니다.",
  NOT_PARTICIPATED: "승인된 입찰 내역이 없습니다.",
  NOT_APPLICABLE: "이 경매에는 개인 낙찰 결과가 없습니다.",
  NOT_FINALIZED: "아직 경매 결과가 확정되지 않았습니다.",
} as const;

type Outcome = keyof typeof messages;
type Result = { status: "LOADING" | "AUTH_REQUIRED" | "FORBIDDEN" | "ERROR" } | { status: "READY"; outcome: Outcome };
type Props = Readonly<{ auctionId: string; actorId?: string; client: ApiClient }>;

export function PrivateAuctionOutcome({ auctionId, actorId, client }: Props) {
  const [result, setResult] = useState<Result>({ status: "LOADING" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    client.get<{ auctionId: string; outcome: Outcome }>(`/api/v1/me/auctions/${auctionId}/outcome`,
      actorId ? { "X-Actor-Id": actorId } : undefined).then(response => {
      if (!active) return;
      setResult(response.auctionId === auctionId && Object.hasOwn(messages, response.outcome)
        ? { status: "READY", outcome: response.outcome }
        : { status: "ERROR" });
    }).catch((error: unknown) => {
      if (!active) return;
      setResult({ status: error instanceof ApiError && error.status === 401 ? "AUTH_REQUIRED"
        : error instanceof ApiError && error.status === 403 ? "FORBIDDEN" : "ERROR" });
    });
    return () => { active = false; };
  }, [actorId, attempt, auctionId, client]);

  return <section className="auction-private-result" aria-labelledby="auction-private-result-title">
    <h2 id="auction-private-result-title">본인 입찰 결과</h2>
    {result.status === "LOADING" && <StatusMessage kind="loading">본인 결과를 조회하고 있습니다.</StatusMessage>}
    {result.status === "READY" && <StatusMessage kind={result.outcome === "WON" ? "success" : "empty"}>{messages[result.outcome]}</StatusMessage>}
    {result.status === "AUTH_REQUIRED" && <div className="auction-detail-message">
      <StatusMessage kind="error">본인 결과를 보려면 다시 로그인해 주세요.</StatusMessage>
      <a className="ui-button ui-button--secondary ui-button--md" href="/login">다시 로그인</a>
    </div>}
    {result.status === "FORBIDDEN" && <StatusMessage kind="error">본인 결과를 조회할 권한이 없습니다.</StatusMessage>}
    {result.status === "ERROR" ? <>
      <StatusMessage kind="error">본인 결과를 불러오지 못했습니다.</StatusMessage>
      <Button variant="secondary" onClick={() => {
        setResult({ status: "LOADING" });
        setAttempt(value => value + 1);
      }}>본인 결과 재조회</Button>
    </> : null}
  </section>;
}
