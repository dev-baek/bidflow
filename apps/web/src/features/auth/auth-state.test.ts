import { describe, expect, it } from "vitest";
import { createAuthState, authReducer } from "./auth-state";

describe("authReducer", () => {
  it("moves a local user through sign-in and sign-out without retaining a token", () => {
    const signingIn = authReducer(createAuthState(), { type: "LOCAL_SIGN_IN_REQUESTED", actorId: "local-seller" });
    const authenticated = authReducer(signingIn, { type: "AUTHENTICATED", subject: "local-seller" });
    const signedOut = authReducer(authenticated, { type: "SIGNED_OUT" });

    expect(signingIn).toEqual({ mode: "AUTHENTICATING", provider: "LOCAL" });
    expect(authenticated).toEqual({ mode: "AUTHENTICATED", subject: "local-seller", provider: "LOCAL" });
    expect(signedOut).toEqual({ mode: "ANONYMOUS" });
  });

  it("represents an authentication failure without exposing token details", () => {
    const failed = authReducer(createAuthState(), {
      type: "AUTHENTICATION_FAILED",
      message: "로그인에 실패했습니다. 다시 시도하세요.",
    });

    expect(failed).toEqual({ mode: "FAILED", message: "로그인에 실패했습니다. 다시 시도하세요." });
  });

  it("moves an authenticated session to expired and allows a new sign-in attempt", () => {
    const expired = authReducer(
      { mode: "AUTHENTICATED", session: { accessToken: "mock", expiresAt: 100 }, provider: "COGNITO" },
      { type: "SESSION_EXPIRED" },
    );
    const retrying = authReducer(expired, { type: "COGNITO_SIGN_IN_REQUESTED" });

    expect(expired).toEqual({ mode: "EXPIRED" });
    expect(retrying).toEqual({ mode: "AUTHENTICATING", provider: "COGNITO" });
  });
});
