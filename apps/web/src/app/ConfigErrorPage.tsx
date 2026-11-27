import type { RuntimeConfigError } from "../shared/config/runtime-config";
import { Button } from "../shared/ui/Button";
import { ErrorPage } from "../shared/ui/ErrorPage";
import { StatusMessage } from "../shared/ui/Feedback";

const localHint = {
  "api-url": "VITE_API_BASE_URL 설정을 확인하세요.",
  "ws-url": "VITE_WS_BASE_URL 설정을 확인하세요.",
  "auth-mode": "VITE_AUTH_MODE와 로컬 연결 주소 설정을 확인하세요.",
  cognito: "공개 인증 설정과 콜백 주소를 확인하세요.",
} satisfies Record<RuntimeConfigError, string>;

export function ConfigErrorPage({ reason }: Readonly<{ reason: RuntimeConfigError }>) {
  return <ErrorPage label="시작 설정 오류" title="BidFlow를 시작할 수 없습니다" tone="error">
    <StatusMessage kind="error">연결 설정이 올바르지 않아 서비스를 열 수 없습니다.</StatusMessage>
    {import.meta.env.DEV
      ? <p className="error-panel__hint">{localHint[reason]} 변경 후 개발 서버를 다시 실행하세요.</p>
      : <p className="error-panel__hint">잠시 후 새로고침해 보세요. 문제가 계속되면 서비스 운영자에게 문의하세요.</p>}
    <div className="error-panel__actions">
      <Button onClick={() => window.location.reload()}>새로고침</Button>
    </div>
  </ErrorPage>;
}
