# [Issue #98] 상품 등록부터 낙찰까지 E2E 시나리오

- 상태: 제안됨
- 관련 Issue: [#98 상품 등록부터 낙찰까지 E2E 시나리오 작성](https://github.com/dev-baek/bidflow/issues/98)
- 후속 구현: #99 Playwright 핵심 E2E 테스트

## 1. 목적과 경계

이 시나리오는 상품 등록, 두 입찰자의 자동 최대가 경쟁, 실시간 상태 반영, 경매 종료와 낙찰 확정을 하나의 흐름으로 검증한다. Browser는 화면·HTTP·WebSocket 계약을 확인하고, PostgreSQL 원장과 Kafka 이벤트는 최종 사실을 확인하는 보조 증적이다.

테스트가 시간 경과·기존 개발 데이터·외부 Cognito 계정에 의존하면 재현성이 떨어진다. 따라서 테스트 전용 인증 주체, UUID Fixture namespace, 서버 `Clock` 제어를 사용한다. 실제 사용자 계정·기존 경매·공유 Redis 전체 데이터를 초기화하지 않는다.

## 2. S. 화면과 사용자 흐름

### 2.1 등장 인물

| 주체 | 역할 | 목적 |
|---|---|---|
| Seller | 상품 등록자 | 등록과 낙찰 결과 확인 |
| Bidder A | 자동 입찰자 | 더 높은 최대가(30,000원) 등록 |
| Bidder B | 자동 입찰자 | 낮은 최대가(20,000원) 등록 |

### 2.2 핵심 Browser 흐름

1. Seller가 이미지 1장, 시작가 10,000원, 미래의 시작/종료 시각으로 상품과 경매를 등록한다.
2. 등록 완료 화면은 `productId`, `auctionId`와 등록 성공 상태를 표시한다. 등록 직후 검색 색인은 최종적 일관성을 허용한다.
3. 경매가 활성화된 뒤 Bidder A가 자동 최대가 30,000원을 제출하고 `PENDING`과 `bidRequestId`를 확인한다.
4. Bidder B가 자동 최대가 20,000원을 제출한다. 두 브라우저는 공개 현재가와 종료 시각을 받고, 최대가·다른 사용자의 식별자는 표시하지 않는다.
5. Bidder A/B 화면은 각자의 `bid.result`만 수신한다. 공개 `auction.updated`에는 현재가·종료 시각·상태만 포함한다.
6. 테스트 Clock을 종료 시각 이후로 진행하고 Scheduler Polling을 기다린다.
7. Seller와 Bidder A는 `ENDED`, `SOLD`, 최종가와 낙찰자/패찰 결과를 확인한다. Bidder B에게 Bidder A의 개인 최대가는 노출되지 않는다.

## 3. D. Fixture·기대 원장 상태

### 3.1 Fixture

| 항목 | 값 |
|---|---|
| 상품 | `e2e-{runId}-camera`, 설명 10자 이상, 이미지 1장 |
| 시작가 | 10,000원 |
| 최소 호가 | 1,000원 |
| Bidder A 최대가 | 30,000원 |
| Bidder B 최대가 | 20,000원 |
| 테스트 시간 | 활성화 후 종료 10분 전에서 시작, 마지막에 종료 시각 + 1초 |

자동 최대가 등록 순서는 A 뒤 B다. 현재 자동입찰 Lua 규칙에서 공개 현재가는 21,000원, 최고 입찰자는 A가 된다. 이 값은 최대가 30,000원이 아니라 두 최대가 경쟁의 다음 호가이므로, 화면·이벤트·원장은 21,000원을 기대한다.

### 3.2 종료 뒤 검증

| 대상 | 기대 상태 |
|---|---|
| `auction` | `ENDED`, `current_price=21000`, `current_winner_id=Bidder A` |
| `auction_result` | 한 행, `SOLD`, winner=Bidder A, final_price=21000 |
| `bid_request` | A/B 요청 모두 최종 상태, 중복 request 없음 |
| `bid_ledger` | 요청별 한 행, 승인 결과와 현재가 일치 |
| `outbox_event` | `BidAccepted`, 필요 시 `AuctionExtended`, `AuctionEnded`의 eventId 중복 없음 |
| `consumer_event` | 같은 Consumer/eventId 조합 한 행 이하 |

## 4. B. API·이벤트·시간 계약

| 단계 | 명령/이벤트 | Browser 기대 |
|---|---|---|
| 등록 | 등록 API와 `ListingPublished` | 등록 성공 뒤 경매 ID 확보 |
| 자동 입찰 A/B | `POST /api/v1/auctions/{id}/bid-requests`, `AUTO_MAX` | 두 요청 모두 `202 RECEIVED`, 각자 고유 `bidRequestId` |
| 결과 | `BidAccepted`, `bid.result`, `auction.updated` | 개인 결과는 제출자만, 공개 상태는 모두 |
| 종료 | Scheduler의 `AuctionEnded` | 공개 `auction.ended`, REST Snapshot은 `ENDED` |

`AuctionEnded`가 WebSocket보다 먼저/나중에 도착해도 REST Snapshot이 최종 기준이다. Browser reducer는 낮은 version 또는 동일 version의 과거 `endsAt`으로 화면을 되돌리지 않는다.

## 5. I. 테스트 환경과 격리

```text
Playwright Chromium
  → Vite web
  → Spring Boot test profile
  → PostgreSQL, Kafka, Redis, SeaweedFS, OpenSearch (BidFlow local Compose)
```

- `e2e` Spring profile은 test-only actor 인증과 조절 가능한 `Clock`을 제공한다. 운영 profile에는 포함하지 않는다.
- Clock 진행은 테스트 전용 제어 경계만 사용한다. Browser에서 실제 10분을 기다리거나 OS 시간을 바꾸지 않는다.
- `runId`를 Fixture title, idempotency key, 테스트 사용자 이름에 포함한다.
- 테스트 종료는 해당 `runId` 데이터만 제거하거나 별도 test DB/Redis DB를 사용한다. `FLUSHALL`·전체 volume 삭제는 금지한다.

## 6. T. Playwright 인수 시나리오

| ID | Given | When | Then |
|---|---|---|---|
| E2E-01 | Seller 로그인·등록 화면 | 유효 상품/이미지/경매 입력 후 제출 | 등록 성공과 경매 ID 표시 |
| E2E-02 | 활성 경매·Bidder A | A가 `AUTO_MAX 30000` 제출 | `202/PENDING` 뒤 A의 개인 승인 결과 |
| E2E-03 | A 최대가가 등록됨·Bidder B | B가 `AUTO_MAX 20000` 제출 | 공개 현재가 21,000원, A가 최고 입찰자이며 B 최대가 비공개 |
| E2E-04 | 결과 WebSocket 수신 | 과거 version 이벤트를 추가 전달 | 현재가/종료 시각이 뒤로 가지 않음 |
| E2E-05 | 활성 경매 | Clock을 종료 시각 뒤로 진행 | Scheduler 뒤 `ENDED/SOLD/21000`, `AuctionEnded` 한 번 |
| E2E-06 | 종료된 경매 | 새 입찰 요청 | 새 승인 원장·낙찰자·현재가 변경 없음 |

Playwright는 E2E-01~05를 필수로, E2E-06은 API/DB 보조 검증과 함께 수행한다. 색인 반영은 비동기이므로 고정 sleep 대신 제한된 polling으로 Search Projection 상태를 기다린다.

## 7. 실패 증적과 완료 기준

- 실패 시 screenshot, trace, browser console, HTTP 응답, WebSocket eventId/version, `runId` SQL 결과를 `test-results/`에 보관한다.
- 환경이 준비되지 않았으면 테스트를 통과 처리하지 않는다. 어떤 의존성이 준비되지 않았는지 명확히 실패한다.
- 각 흐름의 최대가 비공개·이벤트 중복 없음·낙찰 단일성은 UI만이 아니라 원장 검증까지 만족해야 한다.

## 8. 완료 조건

- [x] 사용자·화면·개인/공개 실시간 결과를 정의했다.
- [x] 자동 최대가 경쟁의 수치와 종료 후 원장 불변식을 정의했다.
- [x] 테스트 Clock, Fixture namespace, 데이터 격리 경계를 정의했다.
- [x] #99가 구현할 Playwright 인수 시나리오와 실패 증적을 정의했다.
