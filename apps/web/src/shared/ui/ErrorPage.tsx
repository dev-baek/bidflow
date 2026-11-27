import type { ReactNode } from "react";
import { Badge, type FeedbackTone } from "./Feedback";
import { PageLayout } from "./PageLayout";

export function ErrorPage({ label, title, tone = "neutral", children }: Readonly<{
  label: string;
  title: string;
  tone?: FeedbackTone;
  children: ReactNode;
}>) {
  return <PageLayout width="form">
    <section className="error-panel" aria-labelledby="error-title">
      <Badge tone={tone}>{label}</Badge>
      <h1 id="error-title">{title}</h1>
      {children}
    </section>
  </PageLayout>;
}
