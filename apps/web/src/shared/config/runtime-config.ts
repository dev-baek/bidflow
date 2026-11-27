import { validateCognitoConfig, type CognitoConfig } from "../../features/auth/cognito-flow";

export type RuntimeConfig = Readonly<{
  apiBaseUrl: string;
  wsBaseUrl: string;
  cognito?: CognitoConfig;
}>;

export type RuntimeConfigError = "api-url" | "ws-url" | "auth-mode" | "cognito";

export type RuntimeConfigResult =
  | { readonly ok: true; readonly value: RuntimeConfig }
  | { readonly ok: false; readonly reason: RuntimeConfigError };

export function parseRuntimeConfig(
  env: Readonly<Record<string, string | undefined>>,
): RuntimeConfigResult {
  const apiBaseUrl = validUrl(env.VITE_API_BASE_URL, ["http:", "https:"]);
  if (!apiBaseUrl) {
    return { ok: false, reason: "api-url" };
  }

  const wsBaseUrl = validUrl(env.VITE_WS_BASE_URL, ["ws:", "wss:"]);
  if (!wsBaseUrl) {
    return { ok: false, reason: "ws-url" };
  }

  const mode = env.VITE_AUTH_MODE ?? "local";
  let cognito: CognitoConfig | undefined;
  if (mode === "cognito") {
    try {
      cognito = validateCognitoConfig({
        issuer: env.VITE_COGNITO_ISSUER ?? "",
        origin: env.VITE_COGNITO_ORIGIN ?? "",
        clientId: env.VITE_COGNITO_CLIENT_ID ?? "",
        redirectUri: env.VITE_COGNITO_REDIRECT_URI ?? "",
      });
      if (new URL(cognito.redirectUri).pathname !== "/auth/callback"
        || new URL(apiBaseUrl).protocol !== "https:" || new URL(wsBaseUrl).protocol !== "wss:") {
        throw new Error("invalid Cognito configuration");
      }
    } catch {
      return { ok: false, reason: "cognito" };
    }
  } else if (mode !== "local" || ![apiBaseUrl, wsBaseUrl].every(loopback)
    || Object.keys(env).some(key => key.startsWith("VITE_COGNITO_") && env[key])) {
    return { ok: false, reason: "auth-mode" };
  }

  return {
    ok: true,
    value: {
      apiBaseUrl: removeTrailingSlash(apiBaseUrl),
      wsBaseUrl: removeTrailingSlash(wsBaseUrl),
      ...(cognito ? { cognito } : {}),
    },
  };
}

function loopback(value: string): boolean {
  return ["localhost", "127.0.0.1", "[::1]"].includes(new URL(value).hostname);
}

function validUrl(raw: string | undefined, protocols: readonly string[]): string | null {
  if (!raw) {
    return null;
  }

  try {
    const parsed = new URL(raw);
    return protocols.includes(parsed.protocol) ? raw : null;
  } catch {
    return null;
  }
}

function removeTrailingSlash(value: string): string {
  return value.replace(/\/$/, "");
}
