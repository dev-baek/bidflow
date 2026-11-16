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
- 입찰이 없는 등록 경매는 마감 직전 `SCHEDULED`를 유지하고, 마감에 새로고침 없이 `유찰`을 표시한다. 공개 REST는 `ENDED / UNSOLD / finalPrice=null`을 반환한다([#228](https://github.com/dev-baek/bidflow/issues/228)).
- 마감 1분 전, 서로 분리된 Browser context의 자동 최대가(30,000원·20,000원) 요청 접수
- 첫 승인 입찰 뒤 기존 종료 시각 12:30 UTC에서 12:35 UTC로 정확히 5분 연장된 종료 시각 표시
- 각 입찰자에게 `/user/queue/bid-results`로 전달되는 개인 정산 결과 표시
- STOMP 공개 토픽 구독 뒤 양쪽 화면의 현재가 21,000원 동기화
- 두 번째 입찰자는 첫 번째 입찰자의 최대가(30,000원)를 화면에서 확인할 수 없음
- 원래 마감 12:30 UTC에 연장되지 않은 대조 경매가 종료될 때까지 공개 REST를 조회하고, 대상 경매는 `ACTIVE`와 21,000원을 유지하는지 확인
- 새 마감 12:35 UTC에 두 브라우저가 새로고침 없이 `ENDED`와 공개 낙찰가 21,000원을 표시하고 입찰 폼을 제거하는지 확인
- 공개 REST가 `ENDED / SOLD`, 최종가 21,000원, 연장된 마감을 반환하는지 확인

대조 경매에는 마감 6분 전 정상 직접 입찰을 넣어 연장 없이 `ACTIVE`를 만든다. 종료 이후 별도 API 입찰 요청, 검색→상세, 개인 낙찰·패찰(#227) 검증은 이 시나리오 범위가 아니다.
