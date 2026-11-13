# [Issue #105] 경매 자동 연장 경계·반복·보정 테스트 보고서

- 작업 완료일: 2026-11-13
- Issue: [#105 경매 자동 연장 경계·반복·보정 테스트](https://github.com/dev-baek/bidflow/issues/105)
- 사양: [issue-015-auction-close.md](../specs/issue-015-auction-close.md)
- 브랜치: `feature/issue-105-auction-extension-tests`

## 1. RED → GREEN

- RED: Redis Lua가 `now + 5분`을 계산해 순수 도메인 규칙의 `기존 endsAt + 5분`과 불일치했다. #104에서 4분·정확히 5분·반복 연장 통합 테스트를 추가해 이 차이를 재현했다.
- GREEN: Lua를 수정한 뒤 같은 테스트가 통과했고, 이 작업에서는 PostgreSQL Scheduler 보정과 Browser 상태 적용까지 증적을 확장했다.

## 2. 검증 결과

| 범위 | 검증 |
|---|---|
| 순수 규칙 | 4분 59초 승인 연장, 정확히 5분 비연장, 거절 비연장 |
| Redis Lua | 직접·자동 입찰의 기존 종료 시각 +5분, 반복 연장, 같은 요청 replay |
| PostgreSQL | 연장 Transaction 뒤 원래 종료 시각에서 Scheduler가 경매를 종료하지 않음 |
| Scheduler 다중 실행 | `FOR UPDATE SKIP LOCKED` 통합 테스트로 결과·Outbox가 한 번만 생성됨 |
| Browser 상태 | `BidAccepted → AuctionExtended`가 같은 version이어도 새 `endsAt`을 표시하며 지연 이벤트는 시간을 되돌리지 않음 |

## 3. 실행 증적

~~~sh
./backend/gradlew --no-daemon -p backend \
  :adapters:test --tests com.bidflow.adapters.persistence.JdbcBidLedgerRepositoryIntegrationTest

npx --yes node@24 ./node_modules/vitest/vitest.mjs run
npm run build
~~~

- `JdbcBidLedgerRepositoryIntegrationTest`: 5개 테스트 통과. 연장된 `ends_at`에서 원래 종료 시각으로 Scheduler를 호출해도 `ACTIVE` 상태와 `AuctionExtended` Outbox 한 건을 유지한다.
- Vitest: 9개 파일, 28개 테스트 통과.
- Vite TypeScript production build 통과.

## 4. 런타임 주의

프로젝트의 Node engine은 24.x다. 로컬 기본 Node 20에서는 jsdom/undici 호환성 문제로 Vitest worker가 시작하지 않으므로, 검증은 Node 24로 수행했다.
