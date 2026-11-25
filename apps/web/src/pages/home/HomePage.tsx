import { Link } from "react-router-dom";
import { useAuth } from "../../features/auth/auth-context";

export function HomePage() {
  const { state, signOut } = useAuth();
  return (
    <main className="app-shell">
      <section className="hero" aria-labelledby="bidflow-title">
        <p className="eyebrow">REAL-TIME AUCTION PLATFORM</p>
        <h1 id="bidflow-title">BidFlow</h1>
        <p className="hero-copy">
          입찰의 순서와 결과를 신뢰할 수 있게 전달하는 실시간 경매 플랫폼입니다.
        </p>
        {state.mode === "AUTHENTICATED" ? (
          <div className="auth-summary">
            <p>{state.provider === "LOCAL" ? <><strong>{state.subject}</strong>으로 로그인했습니다.</> : "Cognito로 로그인했습니다."}</p>
            <button type="button" onClick={signOut}>로그아웃</button>
          </div>
        ) : (
          <Link to="/login">로그인</Link>
        )}
        <Link to="/listings/new">상품 등록 화면 열기</Link>
        <Link to="/listings">상품 검색 화면 열기</Link>
      </section>
    </main>
  );
}
