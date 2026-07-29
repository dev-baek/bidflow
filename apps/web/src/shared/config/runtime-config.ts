export type RuntimeConfig = Readonly<{
  apiBaseUrl: string;
  wsBaseUrl: string;
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

  return {
    ok: true,
    value: {
      apiBaseUrl: removeTrailingSlash(apiBaseUrl),
      wsBaseUrl: removeTrailingSlash(wsBaseUrl),
    },
  };
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
