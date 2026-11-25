import { useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../../features/auth/auth-context";

export function LoginPage() {
  const [actorId, setActorId] = useState("");
  const { state, signInLocal, cognitoEnabled, signInCognito } = useAuth();
  const navigate = useNavigate();

  if (state.mode === "AUTHENTICATED") {
    return <Navigate to="/" replace />;
  }

  if (cognitoEnabled) {
    return <main className="app-shell">
      <section className="listing-form auth-card" aria-labelledby="login-title">
        <h1 id="login-title">로그인</h1>
        {state.mode === "EXPIRED" && <p role="alert">세션이 만료되었습니다. 다시 로그인하세요.</p>}
        {state.mode === "FAILED" && <p role="alert">{state.message}</p>}
        <button type="button" disabled={state.mode === "AUTHENTICATING"} onClick={() => void signInCognito()}>
          Cognito 로그인
        </button>
      </section>
    </main>;
  }

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    signInLocal(actorId);
    if (actorId.trim().length > 0) {
      navigate("/", { replace: true });
    }
  };

  return (
    <main className="app-shell">
      <section className="listing-form auth-card" aria-labelledby="login-title">
        <p className="eyebrow">LOCAL AUTHENTICATION</p>
        <h1 id="login-title">로그인</h1>
        <p className="form-intro">
          로컬 개발 환경에서는 Cognito 대신 개발자 ID로 인증된 사용자를 재현합니다.
        </p>

        {state.mode === "EXPIRED" ? <p className="form-alert" role="alert">세션이 만료되었습니다. 다시 로그인하세요.</p> : null}
        {state.mode === "FAILED" ? <p className="form-alert" role="alert">{state.message}</p> : null}

        <form onSubmit={submit} noValidate>
          <div className="form-field">
            <label htmlFor="local-actor-id">로컬 개발자 ID</label>
            <input
              id="local-actor-id"
              value={actorId}
              onChange={(event) => setActorId(event.target.value)}
              autoComplete="username"
            />
          </div>
          <button type="submit">로컬 로그인</button>
        </form>

        <p className="field-help">
          AWS 검증 환경에서는 이 Header adapter를 사용하지 않습니다. Cognito PKCE 로그인은 User Pool 구성(#39) 이후 연결합니다.
        </p>
      </section>
    </main>
  );
}
