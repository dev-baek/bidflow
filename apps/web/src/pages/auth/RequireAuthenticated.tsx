import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../../features/auth/auth-context";

export function RequireAuthenticated() {
  const { state } = useAuth();
  const location = useLocation();

  if (state.mode !== "AUTHENTICATED") {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (state.provider === "COGNITO") return <main className="app-shell">
    <p role="status">Cognito 세션의 보호 요청 연결은 아직 지원하지 않습니다.</p>
  </main>;
  return <Outlet />;
}
