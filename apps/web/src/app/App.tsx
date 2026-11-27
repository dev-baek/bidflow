import { useMemo } from "react";
import { RouterProvider } from "react-router-dom";
import type { RuntimeConfig, RuntimeConfigResult } from "../shared/config/runtime-config";
import { createAppRouter } from "./create-router";
import { AuthProvider, type CognitoBrowser } from "../features/auth/auth-context";
import { createCognitoFlow } from "../features/auth/cognito-flow";
import { ConfigErrorPage } from "./ConfigErrorPage";

export type AppProps = Readonly<{
  configResult: RuntimeConfigResult;
}>;

export function App({ configResult }: AppProps) {
  return configResult.ok ? <ConfiguredApp config={configResult.value} /> : <ConfigErrorPage reason={configResult.reason} />;
}

function ConfiguredApp({ config }: Readonly<{ config: RuntimeConfig }>) {
  const { apiBaseUrl, wsBaseUrl } = config;
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
  const invalidAuth = cognito === null;
  const router = useMemo(() => invalidAuth ? null : createAppRouter(apiBaseUrl, wsBaseUrl),
    [apiBaseUrl, wsBaseUrl, invalidAuth]);
  if (!router || cognito === null) return <ConfigErrorPage reason="cognito" />;

  return (
    <AuthProvider cognito={cognito}>
      <RouterProvider router={router} />
    </AuthProvider>
  );
}
