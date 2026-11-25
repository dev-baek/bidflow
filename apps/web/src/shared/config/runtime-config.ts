import { validateCognitoConfig, type CognitoConfig } from "../../features/auth/cognito-flow";

export type RuntimeConfig = Readonly<{
  apiBaseUrl: string;
  wsBaseUrl: string;
  cognito?: CognitoConfig;
}>;

export type RuntimeConfigResult =
  | { readonly ok: true; readonly value: RuntimeConfig }
  | { readonly ok: false; readonly message: string };

export function parseRuntimeConfig(
  env: Readonly<Record<string, string | undefined>>,
): RuntimeConfigResult {
  const apiBaseUrl = validUrl(env.VITE_API_BASE_URL, ["http:", "https:"]);
  if (!apiBaseUrl) {
    return { ok: false, message: "VITE_API_BASE_URL 설정을 확인하세요." };
  }

  const wsBaseUrl = validUrl(env.VITE_WS_BASE_URL, ["ws:", "wss:"]);
  if (!wsBaseUrl) {
    return { ok: false, message: "VITE_WS_BASE_URL 설정을 확인하세요." };
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
      return { ok: false, message: "Cognito 공개 인증 설정을 확인하세요." };
    }
  } else if (mode !== "local" || ![apiBaseUrl, wsBaseUrl].every(loopback)
    || Object.keys(env).some(key => key.startsWith("VITE_COGNITO_") && env[key])) {
    return { ok: false, message: "VITE_AUTH_MODE 설정을 확인하세요." };
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
