# [Issue #99] Playwright E2E 실행 기준

## 실행 전제

Playwright는 임의의 개발 서버나 AWS 환경을 자동으로 만들지 않는다. 다음 local 전용 환경을 사용한다.

```sh
make local-up

# 터미널 1: Spring Boot (test-only Clock 포함)
SPRING_PROFILES_ACTIVE=local,e2e ./backend/gradlew --no-daemon -p backend :runtime:bootRun

# 터미널 2: Vite
cd apps/web
VITE_API_BASE_URL=http://localhost:8080 VITE_WS_BASE_URL=ws://localhost:8080 npm run dev -- --host 127.0.0.1

# 터미널 3: Playwright
cd apps/web
npx playwright install chromium
BIDFLOW_E2E_BASE_URL=http://127.0.0.1:5173 npm run test:e2e
```

WebSocket handshake는 `bidflow.realtime.allowed-origin-patterns`에 등록된 origin만 받는다. local 기본값은
`http://localhost:5173,http://127.0.0.1:5173`이며, 배포 환경에서는 `BIDFLOW_REALTIME_ALLOWED_ORIGIN_PATTERNS`에 실제 웹 origin을 지정한다.
테스트 Clock API의 기본 주소는 `http://127.0.0.1:8080`이며, 다른 주소를 쓸 때만 `BIDFLOW_E2E_API_BASE_URL`을 지정한다.

`BIDFLOW_E2E_BASE_URL`가 없으면 E2E는 skip되며 성공으로 주장하지 않는다. 실패하면 trace·screenshot·HTML report가 `apps/web/test-results/`에 남는다.

## 현재 시나리오

- 로컬 판매자 로그인
- Browser의 presign PUT 이미지 업로드
- 상품·경매 등록
- 서버가 반환한 경매 ID 표시
- 별도 Browser context의 자동 최대가(30,000원) 요청 접수
- STOMP 공개 토픽 구독 뒤 비동기 정산 결과인 현재가 11,000원 표시

두 입찰자의 최대가 경쟁, 자동 연장, 종료 확정은 같은 #99 시나리오에 추가한다.
