import { Link } from "react-router-dom";
import { useAuth } from "../../features/auth/auth-context";
import { Badge } from "../../shared/ui/Feedback";
import { PageLayout } from "../../shared/ui/PageLayout";

const steps = [
  ["상품 찾기", "검색에서 현재가와 마감 시각을 비교하세요."],
  ["입찰하기", "경매 상세에서 직접 입찰하거나 자동 입찰 한도를 정하세요."],
  ["결과 확인", "마감 후 공개 경매 결과와 내 입찰 결과를 확인하세요."],
] as const;

export function HomePage() {
  const { state } = useAuth();
  return <PageLayout>
    <div className="home-intro">
      <section className="home-hero" aria-labelledby="bidflow-title">
        <Badge tone="info">실시간 경매</Badge>
        <h1 id="bidflow-title">지금 진행 중인 경매를 둘러보세요</h1>
        <p>마음에 드는 상품을 찾고, 현재가와 마감 시간을 확인한 뒤 입찰하세요.</p>
        <div className="home-actions">
          <Link className="ui-button ui-button--primary ui-button--lg" to="/listings">경매 둘러보기</Link>
          <Link className="ui-button ui-button--secondary ui-button--lg" to="/listings/new">상품 등록하기</Link>
        </div>
        {state.mode === "AUTHENTICATED" && <p>
          {state.provider === "LOCAL" ? <><strong>{state.subject}</strong>으로 로그인했습니다.</> : "로그인했습니다."}
        </p>}
      </section>
      <section className="home-steps" aria-labelledby="home-steps-title">
        <h2 id="home-steps-title">이렇게 이용해요</h2>
        <ol role="list">
          {steps.map(([title, description], index) => <li key={title}>
            <span className="home-step__number" aria-hidden="true">{index + 1}</span>
            <div><h3>{title}</h3><p>{description}</p></div>
          </li>)}
        </ol>
      </section>
    </div>
  </PageLayout>;
}
