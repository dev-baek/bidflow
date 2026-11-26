export type FeedbackTone = "neutral" | "info" | "success" | "warning" | "error";

const statusTones = {
  loading: "info",
  empty: "neutral",
  success: "success",
  warning: "warning",
  error: "error",
} satisfies Record<string, FeedbackTone>;

export function Badge({ tone = "neutral", children }: Readonly<{ tone?: FeedbackTone; children: string }>) {
  return <span className={`ui-badge ui-tone--${tone}`}>{children}</span>;
}

export function StatusMessage({ kind, children }: Readonly<{ kind: keyof typeof statusTones; children: string }>) {
  return <p className={`ui-status ui-tone--${statusTones[kind]}`} role={kind === "error" ? "alert" : "status"}>
    {children}
  </p>;
}
