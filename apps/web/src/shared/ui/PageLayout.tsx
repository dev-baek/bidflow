import type { ReactNode } from "react";

type PageLayoutProps = Readonly<{
  width?: "content" | "form" | "auth";
  children: ReactNode;
}>;

export function PageLayout({ width = "content", children }: PageLayoutProps) {
  return <main className={`ui-page ui-page--${width}`}>{children}</main>;
}
