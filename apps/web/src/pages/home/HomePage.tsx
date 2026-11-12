import { Link } from "react-router-dom";

export function HomePage() {
  return (
    <main className="app-shell">
      <section className="hero" aria-labelledby="bidflow-title">
        <p className="eyebrow">REAL-TIME AUCTION PLATFORM</p>
        <h1 id="bidflow-title">BidFlow</h1>
        <p className="hero-copy">
          입찰의 순서와 결과를 신뢰할 수 있게 전달하는 실시간 경매 플랫폼입니다.
        </p>
        <Link to="/listings/new">상품 등록 화면 열기</Link>
      </section>
    </main>
  );
}
