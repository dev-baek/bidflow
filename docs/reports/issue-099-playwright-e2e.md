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

`BIDFLOW_E2E_BASE_URL`이 없으면 E2E는 건너뛴다. 실패 trace·screenshot은 `apps/web/test-results/`에, HTML 보고서는 `apps/web/playwright-report/`에 남는다.

검색까지 검증하려면 저장소 루트에서 `make local-up` 대신 `make local-up-search`로 OpenSearch와 매핑을 준비한다. 같은 로컬 Spring Boot·Vite를 띄운 뒤 `apps/web`에서 다음과 같이 실행한다.

```sh
BIDFLOW_E2E_BASE_URL=http://127.0.0.1:5173 BIDFLOW_E2E_SEARCH=1 npm run test:e2e
```

`BIDFLOW_E2E_SEARCH=1`이 없으면 검색 사례만 건너뛴다. 설정했는데 색인·검색이 동작하지 않으면 테스트는 실패한다.

## 현재 시나리오

[#14](https://github.com/dev-baek/bidflow/issues/14) 연결 복구 테스트는 관찰 브라우저의 WebSocket만 잠시 끊는다. 다른 브라우저가 12,000원 직접 입찰을 확정한 동안 관찰 화면은 10,000원을 유지한다. 이후 다시 연결하면 새로고침 없이 실제 REST 응답과 화면이 12,000원으로 갱신된다. 이전 버전·이전 마감의 늦은 응답 차단은 reducer 테스트로 검증한다.

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
- 종료 1초 뒤 새 직접 입찰을 API로 제출하면 HTTP `202 RECEIVED` 이후 같은 요청 ID의 개인 결과가 `REJECTED / AUCTION_ENDED`로 도착한다. 처리 뒤에도 공개 REST 전체 응답은 바뀌지 않는다. PostgreSQL 통합 테스트로 승인 원장 수, 낙찰자·최종가·버전이 유지되고 거절 사유만 별도 원장에 기록되는지도 확인한다.
- [#227](https://github.com/dev-baek/bidflow/issues/227): 공개 낙찰가 21,000원은 같지만 A에게만 낙찰, B에게만 패찰, 승인 입찰이 없는 사용자에게는 비참여를 표시한다. A의 브라우저를 새로고침하면 로그아웃 상태에서 공개 가격만 확인되고, 다시 로그인하면 개인 결과를 서버에서 다시 조회한다.
- 직접 입찰 E2E: A의 12,000원 요청을 동일 키로 API 재전송하면 같은 요청 ID를 받는다. B가 13,000원으로 추월한 뒤 같은 A 폼에서 14,000원으로 새 입찰하면 다른 키·요청 ID로 승인되고 양쪽 공개 가격이 갱신된다. 접수 응답을 잃은 폼의 키와 개인 결과 유지 동작은 상태/컴포넌트 테스트로 검증한다.
- 검색 E2E: 고유 제목으로 상품을 등록하고 검색 API가 같은 경매 ID를 반환할 때까지 제한 시간 내에서 폴링한다. 브라우저에서 실제 검색을 제출하고 제목 링크가 등록한 경매 상세를 여는지, 이동 뒤에도 로그인 상태가 유지되는지 확인한다.

대조 경매에는 마감 6분 전 정상 직접 입찰을 넣어 연장 없이 `ACTIVE`를 만든다. 개인 낙찰·패찰과 연결 복구 검증은 상위 #20에 연결한다.
