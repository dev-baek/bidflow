import { createContext, useContext, useMemo, useReducer, type ReactNode } from "react";
import { authReducer, createAuthState, type AuthState } from "./auth-state";

type AuthContextValue = Readonly<{
  state: AuthState;
  signInLocal(actorId: string): void;
  signOut(): void;
  expire(): void;
}>;

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [state, dispatch] = useReducer(authReducer, undefined, createAuthState);
  const value = useMemo<AuthContextValue>(() => ({
    state,
    signInLocal(actorId) {
      dispatch({ type: "LOCAL_SIGN_IN_REQUESTED", actorId });
      if (actorId.trim().length > 0) {
        dispatch({ type: "AUTHENTICATED", subject: actorId.trim() });
      }
    },
    signOut() {
      dispatch({ type: "SIGNED_OUT" });
    },
    expire() {
      dispatch({ type: "SESSION_EXPIRED" });
    },
  }), [state]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error("useAuth must be used inside AuthProvider");
  }
  return value;
}
