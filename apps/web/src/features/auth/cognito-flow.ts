export type CognitoConfig = Readonly<{ issuer: string; origin: string; clientId: string; redirectUri: string }>;
type FlowDependencies = Readonly<{
  now: () => number;
  random: Pick<Crypto, "getRandomValues" | "subtle">;
  request: typeof fetch;
  scrub: (cleanUrl: string) => void;
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">;
}>;
export type CognitoGrant = Readonly<{ accessToken: string; expiresAt: number }>;

const storageKey = "bidflow.cognito.pending";
const transactionMs = 5 * 60_000;
const failed = () => new Error("Cognito login failed");
const urlSafe = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes))
  .replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
const isRandomValue = (value: unknown): value is string =>
  typeof value === "string" && value.length === 43 && !/[^A-Za-z0-9_-]/.test(value);

export async function pkceChallenge(verifier: string, subtle: Pick<SubtleCrypto, "digest">) {
  return urlSafe(new Uint8Array(await subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
}

export function validateCognitoConfig(config: CognitoConfig) {
  const origin = new URL(config.origin), issuer = new URL(config.issuer), callback = new URL(config.redirectUri);
  if ([origin, issuer, callback].some(url => url.username || url.password || url.search || url.hash)
    || origin.protocol !== "https:" || origin.pathname !== "/" || issuer.protocol !== "https:"
    || !(callback.protocol === "https:" || (callback.protocol === "http:" && callback.hostname === "localhost"))
    || !config.clientId || config.clientId.length > 128 || /[^a-zA-Z0-9]/.test(config.clientId)) throw failed();
  return { origin: origin.origin, issuer: issuer.href, redirectUri: callback.href, clientId: config.clientId };
}

export function createCognitoFlow(config: CognitoConfig, deps: FlowDependencies) {
  const { origin, issuer, redirectUri, clientId } = (() => {
    try { return validateCognitoConfig(config); }
    catch { throw failed(); }
  })();
  const scope = JSON.stringify([origin, issuer, redirectUri, clientId]);
  let generation = 0;
  const clear = () => {
    generation++;
    deps.storage.removeItem(storageKey);
  };
  const randomValue = () => urlSafe(deps.random.getRandomValues(new Uint8Array(32)));

  return {
    async begin(): Promise<string> {
      try {
        clear();
        const attempt = generation;
        const state = randomValue(), verifier = randomValue();
        const challenge = await pkceChallenge(verifier, deps.random.subtle);
        const startedAt = deps.now();
        if (attempt !== generation || !Number.isSafeInteger(startedAt)
          || !Number.isSafeInteger(startedAt + transactionMs)) throw failed();
        const url = new URL("/oauth2/authorize", origin);
        url.search = new URLSearchParams({
          response_type: "code", client_id: clientId, redirect_uri: redirectUri, scope: "openid",
          state, code_challenge_method: "S256", code_challenge: challenge,
        }).toString();
        deps.storage.setItem(storageKey, JSON.stringify({ state, verifier, scope, startedAt }));
        return url.href;
      } catch {
        throw failed();
      }
    },
    async complete(callbackUrl: string): Promise<CognitoGrant> {
      try {
        const url = new URL(callbackUrl);
        if (url.origin + url.pathname !== redirectUri || url.username || url.password) throw failed();
        const raw = deps.storage.getItem(storageKey);
        deps.storage.removeItem(storageKey);
        deps.scrub(redirectUri);
        const attempt = generation;
        const startedAt = deps.now();
        const pending = JSON.parse(raw ?? "null");
        const states = url.searchParams.getAll("state"), codes = url.searchParams.getAll("code");
        const issuers = url.searchParams.getAll("iss");
        if (!pending || pending.scope !== scope || !isRandomValue(pending.verifier) || !isRandomValue(pending.state)
          || !Number.isSafeInteger(pending.startedAt) || !Number.isSafeInteger(startedAt)
          || startedAt < pending.startedAt || startedAt - pending.startedAt >= transactionMs
          || states.length !== 1 || states[0] !== pending.state || codes.length !== 1 || !codes[0]
          || url.hash || url.searchParams.has("error") || issuers.length > 1
          || (issuers.length === 1 && issuers[0] !== issuer)) throw failed();

        const response = await deps.request(origin + "/oauth2/token", {
          method: "POST", redirect: "error", credentials: "omit", cache: "no-store",
          body: new URLSearchParams({
            grant_type: "authorization_code", client_id: clientId, redirect_uri: redirectUri,
            code: codes[0], code_verifier: pending.verifier,
          }),
        });
        if (!response.ok) throw failed();
        const token = await response.json();
        const expiresAt = startedAt + (token?.expires_in ?? 0) * 1000;
        const receivedAt = deps.now();
        if (attempt !== generation || token?.token_type !== "Bearer"
          || typeof token.access_token !== "string" || !token.access_token
          || /[^A-Za-z0-9._~+/-]/.test(token.access_token)
          || !Number.isSafeInteger(token.expires_in) || !Number.isSafeInteger(expiresAt)
          || !Number.isSafeInteger(receivedAt) || receivedAt < startedAt || expiresAt <= receivedAt) throw failed();
        return { accessToken: token.access_token, expiresAt };
      } catch {
        throw failed();
      }
    },
    clear,
  };
}
