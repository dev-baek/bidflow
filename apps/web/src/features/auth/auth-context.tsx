import { createContext, useCallback, useContext, useEffect, useReducer, useRef, type ReactNode } from "react";
import { authReducer, createAuthState, type AuthState } from "./auth-state";
import type { createCognitoFlow } from "./cognito-flow";

export type CognitoBrowser = Readonly<{
  flow: ReturnType<typeof createCognitoFlow>;
  logoutUrl: string;
  redirect(url: string): void;
}>;

type AuthContextValue = Readonly<{
  state: AuthState;
  cognitoEnabled: boolean;
  signInLocal(actorId: string): void;
  signInCognito(): Promise<void>;
  completeCognito(url: string): Promise<void>;
  signOut(): void;
  expire(): void;
}>;

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children, cognito }: Readonly<{ children: ReactNode; cognito?: CognitoBrowser }>) {
  const [state, dispatch] = useReducer(authReducer, undefined, createAuthState);
  const generation = useRef(0);
  const reset = useCallback((type: "SIGNED_OUT" | "SESSION_EXPIRED") => {
    generation.current++;
    try { cognito?.flow.clear(); } catch { /* Memory still has to be cleared when storage is unavailable. */ }
    dispatch({ type });
  }, [cognito]);
  const fail = (attempt: number) => {
    if (attempt === generation.current) dispatch({ type: "AUTHENTICATION_FAILED", message: "로그인에 실패했습니다. 다시 시도하세요." });
  };
  const completeCognito = useCallback(async (url: string) => {
    if (!cognito) return;
    const attempt = ++generation.current;
    dispatch({ type: "COGNITO_SIGN_IN_REQUESTED" });
    try {
      const session = await cognito.flow.complete(url);
      if (attempt !== generation.current) return;
      if (session.expiresAt <= Date.now()) return reset("SESSION_EXPIRED");
      dispatch({ type: "COGNITO_AUTHENTICATED", session });
    } catch { fail(attempt); }
  }, [cognito, reset]);
  const session = state.mode === "AUTHENTICATED" && state.provider === "COGNITO" ? state.session : undefined;
  useEffect(() => {
    if (!session) return;
    const attempt = generation.current;
    let timer: ReturnType<typeof setTimeout>;
    const check = () => {
      if (attempt !== generation.current) return;
      const remaining = session.expiresAt - Date.now();
      if (remaining <= 0) reset("SESSION_EXPIRED");
      else timer = setTimeout(check, Math.min(remaining, 2_147_483_647));
    };
    check();
    return () => clearTimeout(timer);
  }, [session, reset]);
  const value: AuthContextValue = {
    state,
    cognitoEnabled: !!cognito,
    signInLocal(actorId) {
      if (cognito) return;
      dispatch({ type: "LOCAL_SIGN_IN_REQUESTED", actorId });
      if (actorId.trim().length > 0) {
        dispatch({ type: "AUTHENTICATED", subject: actorId.trim() });
      }
    },
    async signInCognito() {
      if (!cognito) return;
      const attempt = ++generation.current;
      dispatch({ type: "COGNITO_SIGN_IN_REQUESTED" });
      try {
        const url = await cognito.flow.begin();
        if (attempt === generation.current) cognito.redirect(url);
      } catch { fail(attempt); }
    },
    completeCognito,
    signOut() {
      reset("SIGNED_OUT");
      cognito?.redirect(cognito.logoutUrl);
    },
    expire() {
      reset("SESSION_EXPIRED");
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error("useAuth must be used inside AuthProvider");
  }
  return value;
}
