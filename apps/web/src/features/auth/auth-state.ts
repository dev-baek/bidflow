import type { CognitoGrant } from "./cognito-flow";

export type AuthProvider = "LOCAL" | "COGNITO";

export type AuthState =
  | Readonly<{ mode: "ANONYMOUS" }>
  | Readonly<{ mode: "AUTHENTICATING"; provider: AuthProvider }>
  | Readonly<{ mode: "AUTHENTICATED"; subject: string; provider: "LOCAL" }>
  | Readonly<{ mode: "AUTHENTICATED"; session: CognitoGrant; provider: "COGNITO" }>
  | Readonly<{ mode: "FAILED"; message: string }>
  | Readonly<{ mode: "EXPIRED" }>;

export type AuthAction =
  | Readonly<{ type: "LOCAL_SIGN_IN_REQUESTED"; actorId: string }>
  | Readonly<{ type: "COGNITO_SIGN_IN_REQUESTED" }>
  | Readonly<{ type: "AUTHENTICATED"; subject: string }>
  | Readonly<{ type: "COGNITO_AUTHENTICATED"; session: CognitoGrant }>
  | Readonly<{ type: "AUTHENTICATION_FAILED"; message: string }>
  | Readonly<{ type: "SESSION_EXPIRED" }>
  | Readonly<{ type: "SIGNED_OUT" }>;

export function createAuthState(): AuthState {
  return { mode: "ANONYMOUS" };
}

export function authReducer(state: AuthState, action: AuthAction): AuthState {
  switch (action.type) {
    case "LOCAL_SIGN_IN_REQUESTED":
      return action.actorId.trim().length > 0
        ? { mode: "AUTHENTICATING", provider: "LOCAL" }
        : { mode: "FAILED", message: "로컬 개발자 ID를 입력하세요." };
    case "COGNITO_SIGN_IN_REQUESTED":
      return { mode: "AUTHENTICATING", provider: "COGNITO" };
    case "AUTHENTICATED":
      return state.mode === "AUTHENTICATING" && state.provider === "LOCAL"
        ? { mode: "AUTHENTICATED", subject: action.subject, provider: state.provider }
        : state;
    case "COGNITO_AUTHENTICATED":
      return state.mode === "AUTHENTICATING" && state.provider === "COGNITO"
        ? { mode: "AUTHENTICATED", session: action.session, provider: "COGNITO" }
        : state;
    case "AUTHENTICATION_FAILED":
      return { mode: "FAILED", message: action.message };
    case "SESSION_EXPIRED":
      return { mode: "EXPIRED" };
    case "SIGNED_OUT":
      return createAuthState();
  }
}
