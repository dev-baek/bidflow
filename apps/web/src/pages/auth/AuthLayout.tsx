import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { PageLayout } from "../../shared/ui/PageLayout";
import { BrandLink } from "../../shared/ui/BrandLink";

export function AuthLayout({ title, children }: Readonly<{ title: string; children: ReactNode }>) {
  return <PageLayout width="auth">
    <div className="auth-stack">
      <BrandLink />
      <section className="auth-panel" aria-labelledby="auth-page-title">
        <h1 id="auth-page-title">{title}</h1>
        {children}
      </section>
      <Link className="auth-browse" to="/listings">경매 둘러보기 <span aria-hidden="true">→</span></Link>
    </div>
  </PageLayout>;
}
