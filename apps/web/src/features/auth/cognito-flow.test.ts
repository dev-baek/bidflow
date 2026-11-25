// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createCognitoFlow, pkceChallenge } from "./cognito-flow";

const config = {
  issuer: "https://issuer.example.test/pool",
  origin: "https://login.example.test",
  clientId: "publicclient",
  redirectUri: "https://app.example.test/auth/callback",
};

function setup(settings = config, data = new Map<string, string>()) {
  let now = 1000;
  const scrub = vi.fn();
  const request = vi.fn<typeof fetch>(async () => Response.json({
    access_token: "test.access.token", token_type: "Bearer", expires_in: 3600,
    id_token: "unused-id", refresh_token: "unused-refresh",
  }));
  const flow = createCognitoFlow(settings, {
    now: () => now, random: globalThis.crypto, request, scrub,
    storage: { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value),
      removeItem: key => data.delete(key) },
  });
  return { data, flow, request, scrub, advance: (ms: number) => { now += ms; } };
}

describe("Cognito authorization code flow", () => {
  it("matches the S256 reference vector", async () => {
    expect(await pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk", crypto.subtle))
      .toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  it("binds the request, scrubs the callback and consumes the state before one exchange", async () => {
    const { data, flow, request, scrub } = setup();
    const url = new URL(await flow.begin());
    const state = url.searchParams.get("state");
    const [pending] = [...data.values()].map(value => JSON.parse(value));
    expect(url.origin + url.pathname).toBe(config.origin + "/oauth2/authorize");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: "code", client_id: config.clientId, redirect_uri: config.redirectUri,
      scope: "openid", state, code_challenge_method: "S256", code_challenge: await pkceChallenge(pending.verifier, crypto.subtle),
    });
    expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(pending.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(state).not.toBe(pending.verifier);
    const callback = config.redirectUri + "?code=example&state=" + state;
    const exchange = flow.complete(callback);
    await expect(flow.complete(callback)).rejects.toThrow("Cognito login failed");
    await expect(exchange).resolves.toEqual({ accessToken: "test.access.token", expiresAt: 3601000 });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith(config.origin + "/oauth2/token", expect.objectContaining({
      method: "POST", redirect: "error", credentials: "omit",
      body: new URLSearchParams({ grant_type: "authorization_code", client_id: config.clientId,
        redirect_uri: config.redirectUri, code: "example", code_verifier: pending.verifier }),
    }));
    expect(scrub.mock.invocationCallOrder[0]).toBeLessThan(request.mock.invocationCallOrder[0]!);
    expect(data.size).toBe(0);
  });

  it.each(["wrong-state", "missing", "duplicate", "expired", "cancelled", "issuer", "foreign", "corrupt"])(
    "rejects %s before requesting tokens", async (kind) => {
      const { data, flow, request, advance } = setup();
      const state = new URL(await flow.begin()).searchParams.get("state");
      const url = new URL(config.redirectUri + "?code=example&state=" + state);
      if (kind === "wrong-state") url.searchParams.set("state", "other");
      if (kind === "missing") url.searchParams.delete("state");
      if (kind === "duplicate") url.searchParams.append("code", "again");
      if (kind === "cancelled") url.searchParams.set("error", "access_denied");
      if (kind === "issuer") url.searchParams.set("iss", "https://other.example");
      if (kind === "foreign") url.hostname = "other.example";
      if (kind === "expired") advance(300000);
      if (kind === "corrupt") for (const key of data.keys()) data.set(key, "{");
      await expect(flow.complete(url.href)).rejects.toThrow("Cognito login failed");
      expect(request).not.toHaveBeenCalled();
    },
  );

  it.each([Response.json({}, { status: 400 }), Response.json({ access_token: "bad token", token_type: "Bearer", expires_in: 60 }),
    Response.json({ access_token: "token", token_type: "Bearer", expires_in: 0 })])(
    "does not return a session or retry after a bad exchange", async (response) => {
      const { flow, request } = setup();
      request.mockResolvedValueOnce(response);
      const state = new URL(await flow.begin()).searchParams.get("state");
      const url = config.redirectUri + "?code=example&state=" + state;
      await expect(flow.complete(url)).rejects.toThrow("Cognito login failed");
      await expect(flow.complete(url)).rejects.toThrow("Cognito login failed");
      expect(request).toHaveBeenCalledTimes(1);
    },
  );

  it("rejects an exchange that finishes after clearing the session", async () => {
    const { flow, request } = setup();
    let deliver!: (response: Response) => void;
    request.mockImplementationOnce(() => new Promise(resolve => { deliver = resolve; }));
    const state = new URL(await flow.begin()).searchParams.get("state");
    const pending = flow.complete(config.redirectUri + "?code=example&state=" + state);
    flow.clear();
    deliver(Response.json({ access_token: "token", token_type: "Bearer", expires_in: 3600 }));
    await expect(pending).rejects.toThrow("Cognito login failed");
  });

  it("resumes a pending redirect with a new adapter instance for the same settings", async () => {
    const first = setup();
    const state = new URL(await first.flow.begin()).searchParams.get("state");
    const next = setup(config, first.data);
    await expect(next.flow.complete(config.redirectUri + "?code=example&state=" + state)).resolves.toEqual({
      accessToken: "test.access.token", expiresAt: 3601000,
    });
    expect(next.request).toHaveBeenCalledTimes(1);
  });

  it("does not exchange a pending code under a different client configuration", async () => {
    const first = setup();
    const state = new URL(await first.flow.begin()).searchParams.get("state");
    const next = setup({ ...config, clientId: "differentclient" }, first.data);
    await expect(next.flow.complete(config.redirectUri + "?code=example&state=" + state))
      .rejects.toThrow("Cognito login failed");
    expect(next.request).not.toHaveBeenCalled();
  });

  it("does not accept non-HTTPS managed-login endpoints or variable callback URLs", () => {
    for (const invalid of [{ origin: "http://login.example.test" }, { origin: "https://login.example.test/wrong" },
      { redirectUri: config.redirectUri + "?next=other" }]) {
      expect(() => setup({ ...config, ...invalid })).toThrow("Cognito login failed");
    }
  });
});
