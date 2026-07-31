import { Link } from "react-router-dom";

export function NotFoundPage() {
  return (
    <main className="app-shell">
      <section className="message-card">
        <p className="eyebrow">404</p>
        <h1>페이지를 찾을 수 없습니다</h1>
        <Link to="/">BidFlow 홈으로 돌아가기</Link>
      </section>
    </main>
  );
}
