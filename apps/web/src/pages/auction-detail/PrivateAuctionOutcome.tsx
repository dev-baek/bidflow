import { useEffect, useState } from "react";
import { ApiError, type ApiClient } from "../../shared/api/api-client";

const messages = {
  WON: "내가 낙찰받았습니다.",
  LOST: "패찰했습니다.",
  NOT_PARTICIPATED: "승인된 입찰 내역이 없습니다.",
  NOT_APPLICABLE: "이 경매에는 개인 낙찰 결과가 없습니다.",
  NOT_FINALIZED: "아직 경매 결과가 확정되지 않았습니다.",
} as const;

type Outcome = keyof typeof messages;
type Result = { status: "LOADING" | "AUTH_REQUIRED" | "ERROR" } | { status: "READY"; outcome: Outcome };
type Props = Readonly<{ auctionId: string; actorId: string; client: ApiClient }>;

export function PrivateAuctionOutcome({ auctionId, actorId, client }: Props) {
  const [result, setResult] = useState<Result>({ status: "LOADING" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    client.get<{ auctionId: string; outcome: Outcome }>(`/api/v1/me/auctions/${auctionId}/outcome`, {
      "X-Actor-Id": actorId,
    }).then(response => {
      if (!active) return;
      setResult(response.auctionId === auctionId && Object.hasOwn(messages, response.outcome)
        ? { status: "READY", outcome: response.outcome }
        : { status: "ERROR" });
    }).catch((error: unknown) => {
      if (!active) return;
      setResult({ status: error instanceof ApiError && (error.status === 401 || error.status === 403)
        ? "AUTH_REQUIRED" : "ERROR" });
    });
    return () => { active = false; };
  }, [actorId, attempt, auctionId, client]);

  return <section aria-label="본인 입찰 결과">
    {result.status === "LOADING" ? <p role="status">본인 결과를 조회하고 있습니다.</p> : null}
    {result.status === "READY" ? <p role="status">{messages[result.outcome]}</p> : null}
    {result.status === "AUTH_REQUIRED" ? <p role="alert">본인 결과를 보려면 <a href="/login">다시 로그인</a>하세요.</p> : null}
    {result.status === "ERROR" ? <>
      <p role="alert">본인 결과를 불러오지 못했습니다.</p>
      <button type="button" onClick={() => {
        setResult({ status: "LOADING" });
        setAttempt(value => value + 1);
      }}>본인 결과 재조회</button>
    </> : null}
  </section>;
}
