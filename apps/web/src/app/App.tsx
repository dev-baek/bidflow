import { useMemo } from "react";
import { RouterProvider } from "react-router-dom";
import type { RuntimeConfig, RuntimeConfigResult } from "../shared/config/runtime-config";
import { createAppRouter } from "./create-router";
import { AuthProvider, type CognitoBrowser } from "../features/auth/auth-context";
import { createCognitoFlow } from "../features/auth/cognito-flow";

export type AppProps = Readonly<{
  configResult: RuntimeConfigResult;
}>;

export function App({ configResult }: AppProps) {
  return configResult.ok ? <ConfiguredApp config={configResult.value} /> : <ConfigError message={configResult.message} />;
}

function ConfigError({ message }: Readonly<{ message: string }>) {
  return (
    <main className="app-shell">
      <section className="message-card">
        <p className="eyebrow">CONFIGURATION ERROR</p>
        <h1>BidFlow를 시작할 수 없습니다</h1>
        <p role="alert">{message}</p>
      </section>
    </main>
  );
}

function ConfiguredApp({ config }: Readonly<{ config: RuntimeConfig }>) {
  const { apiBaseUrl, wsBaseUrl } = config;
  const router = useMemo(() => createAppRouter(apiBaseUrl, wsBaseUrl), [apiBaseUrl, wsBaseUrl]);
  const cognito = useMemo<CognitoBrowser | null | undefined>(() => {
    if (!config.cognito) return undefined;
    const settings = config.cognito;
    try {
      if (new URL(settings.redirectUri).origin !== window.location.origin || !window.crypto.subtle) return null;
      const logout = new URL("/logout", settings.origin);
      logout.search = new URLSearchParams({
        client_id: settings.clientId,
        logout_uri: new URL("/login", settings.redirectUri).href,
      }).toString();
      return {
        logoutUrl: logout.href,
        redirect: url => window.location.assign(url),
        flow: createCognitoFlow(settings, {
          now: Date.now, random: window.crypto, storage: window.sessionStorage, request: window.fetch.bind(window),
          scrub: url => window.history.replaceState(window.history.state, "", url),
        }),
      };
    } catch { return null; }
  }, [config.cognito]);
  if (cognito === null) return <ConfigError message="Cognito 로그인 환경을 확인하세요." />;

  return (
    <AuthProvider cognito={cognito}>
      <RouterProvider router={router} />
    </AuthProvider>
  );
}
