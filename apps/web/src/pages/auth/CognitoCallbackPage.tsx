import { useEffect, useRef } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../../features/auth/auth-context";
import { StatusMessage } from "../../shared/ui/Feedback";
import { AuthLayout } from "./AuthLayout";

export function CognitoCallbackPage() {
  const { cognitoEnabled, completeCognito, state } = useAuth();
  const started = useRef(false);
  useEffect(() => {
    if (!cognitoEnabled || started.current) return;
    started.current = true;
    void completeCognito(window.location.href);
  }, [cognitoEnabled, completeCognito]);
  if (!cognitoEnabled || state.mode === "FAILED" || state.mode === "EXPIRED") {
    return <Navigate to="/login" replace />;
  }
  if (state.mode === "AUTHENTICATED") return <Navigate to="/" replace />;
  return <AuthLayout title="로그인 확인 중">
    <StatusMessage kind="loading">로그인을 확인하고 있습니다.</StatusMessage>
  </AuthLayout>;
}
