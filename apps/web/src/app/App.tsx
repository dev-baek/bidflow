import { RouterProvider } from "react-router-dom";
import type { RuntimeConfigResult } from "../shared/config/runtime-config";
import { createAppRouter } from "./create-router";

export type AppProps = Readonly<{
  configResult: RuntimeConfigResult;
}>;

export function App({ configResult }: AppProps) {
  if (!configResult.ok) {
    return (
      <main className="app-shell">
        <section className="message-card">
          <p className="eyebrow">CONFIGURATION ERROR</p>
          <h1>BidFlow를 시작할 수 없습니다</h1>
          <p role="alert">{configResult.message}</p>
        </section>
      </main>
    );
  }

  return <RouterProvider router={createAppRouter()} />;
}
