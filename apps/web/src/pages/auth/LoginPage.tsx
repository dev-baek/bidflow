import { useRef, useState, type FormEvent } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../features/auth/auth-context";
import { Button } from "../../shared/ui/Button";
import { Badge, StatusMessage } from "../../shared/ui/Feedback";
import { Field } from "../../shared/ui/Field";
import { AuthLayout } from "./AuthLayout";

export function LoginPage() {
  const [actorId, setActorId] = useState("");
  const actorInput = useRef<HTMLInputElement>(null);
  const { state, signInLocal, cognitoEnabled, signInCognito } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  if (state.mode === "AUTHENTICATED") return <Navigate to="/" replace />;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    signInLocal(actorId);
    if (actorId.trim()) navigate("/", { replace: true });
    else actorInput.current?.focus();
  };

  const pending = state.mode === "AUTHENTICATING";
  return <AuthLayout title="로그인">
    <p className="auth-panel__intro">입찰하거나 상품을 등록하려면 로그인하세요.</p>
    {location.state?.from === "/listings/new" && state.mode !== "EXPIRED" &&
      <StatusMessage kind="warning">상품을 등록하려면 먼저 로그인해 주세요.</StatusMessage>}
    {state.mode === "EXPIRED" &&
      <StatusMessage kind="error">세션이 만료되었습니다. 다시 로그인하세요.</StatusMessage>}

    {cognitoEnabled ? <>
      {state.mode === "FAILED" && <StatusMessage kind="error">{state.message}</StatusMessage>}
      {pending && <StatusMessage kind="loading">로그인 화면으로 이동하고 있습니다.</StatusMessage>}
      <Button size="lg" pendingLabel={pending ? "연결 중" : undefined} onClick={() => void signInCognito()}>
        로그인 계속하기
      </Button>
    </> : <form className="auth-form" onSubmit={submit} noValidate>
      <div className="auth-form__intro">
        <Badge tone="info">로컬 데모</Badge>
        <p>테스트용 ID를 입력하세요. 회원가입이나 비밀번호는 필요 없어요.</p>
      </div>
      <Field id="local-actor-id" label="로컬 개발자 ID" description="예: local-seller"
        error={state.mode === "FAILED" && !actorId.trim() ? state.message : undefined}>
        {control => <input {...control} ref={actorInput} value={actorId}
          onChange={event => setActorId(event.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} />}
      </Field>
      <Button size="lg" type="submit">로컬 로그인</Button>
    </form>}
  </AuthLayout>;
}
