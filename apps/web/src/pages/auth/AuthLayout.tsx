import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { PageLayout } from "../../shared/ui/PageLayout";

export function AuthLayout({ title, children }: Readonly<{ title: string; children: ReactNode }>) {
  return <PageLayout width="auth">
    <div className="auth-stack">
      <Link className="auth-brand" to="/" aria-label="BidFlow 홈">
        <span className="auth-brand__mark" aria-hidden="true">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m14 13-7 7m1-13 6 6m-3-9 6 6m-8-2 3-3m1 7 3-3m0 11h5" />
          </svg>
        </span>
        BidFlow
      </Link>
      <section className="auth-panel" aria-labelledby="auth-page-title">
        <h1 id="auth-page-title">{title}</h1>
        {children}
      </section>
      <Link className="auth-browse" to="/listings">경매 둘러보기 <span aria-hidden="true">→</span></Link>
    </div>
  </PageLayout>;
}
