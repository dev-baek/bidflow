import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../../features/auth/auth-context";

export function RequireAuthenticated() {
  const { state } = useAuth();
  const location = useLocation();

  if (state.mode !== "AUTHENTICATED") {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <Outlet />;
}
