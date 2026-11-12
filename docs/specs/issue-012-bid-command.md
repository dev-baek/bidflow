# [Issue #67] 비동기 입찰 접수 API와 상태 모델

- 상태: 제안됨
- 작성일: 2026-11-12
- 관련 Issue: [#67 비동기 입찰 접수 API와 상태 모델 사양 작성](https://github.com/dev-baek/bidflow/issues/67)
- 선행 사양: [입찰 가격 규칙](./issue-011-bid-domain.md), [Kafka 이벤트 계약](./issue-008-event-contract.md)
- 후속 작업: #68 접수 API, #69 멱등 저장, #70 bid-command Producer, #73/#75 Redis 처리

## 1. 목적과 범위

입찰은 같은 경매에 동시에 몰릴 수 있어 HTTP 요청 처리 중 가격을 확정하지 않는다. API는 멱등적인 요청을 PostgreSQL과 Outbox에 원자적으로 기록한 뒤 `202 Accepted`로 접수 사실만 반환한다. Kafka `bid-command` Worker가 경매별 순서로 최종 승인·거절한다.

## 2. S. 입찰 화면 상태

```text
EDITING → SUBMITTING → PENDING → ACCEPTED | REJECTED
                 └→ REQUEST_ERROR
```

| 상태 | 화면 | 행동 |
|---|---|---|
| `EDITING` | 직접/자동 금액 입력 | 제출 |
| `SUBMITTING` | 중복 클릭 차단 | 대기 |
| `PENDING` | `bidRequestId`와 처리 대기 표시 | 상태 조회·WebSocket 대기 |
| `ACCEPTED` | 현재가·종료 연장 결과 표시 | 다음 입찰 |
| `REJECTED` | 안정 reason 코드의 표시 문구 | 금액 수정·재입찰 |
| `REQUEST_ERROR` | 네트워크·입력 오류 | 같은 요청 ID 재시도 |

Browser는 `bidRequestId`를 한 번 생성해 네트워크 재시도에도 유지한다. `PENDING`에서 화면을 새로 열어도 상태 조회 API로 결과를 복원한다.

## 3. D. 요청·상태 데이터

### 3.1 접수 요청

```http
POST /api/v1/auctions/{auctionId}/bid-requests
Idempotency-Key: 3bb04aac-3ef1-4e95-a265-a93be8c5c96d
Content-Type: application/json

{ "bidKind": "DIRECT", "amount": 55000 }
```

| 필드 | 규칙 |
|---|---|
| `auctionId` | UUID Path, Kafka Key |
| `Idempotency-Key` | 1~128자, 동일 사용자 내 요청 식별자 |
| `bidKind` | `DIRECT` 또는 `AUTO_MAX` |
| `amount` | 1,000 이상 정수. 최종 최소가 판단은 Worker |
| bidderId | Body가 아닌 인증 Actor에서 획득 |

```json
{ "bidRequestId": "b9347c5f-b02f-4a67-89c9-2d2272ed1a32", "status": "RECEIVED" }
```

성공은 항상 `202 Accepted`다. 동일 bidder·Idempotency-Key·동일 payload 재시도는 동일 `bidRequestId`, `202`를 반환한다. 같은 Key에 다른 payload는 `409 IDEMPOTENCY_KEY_PAYLOAD_MISMATCH`다.

### 3.2 상태 조회

```http
GET /api/v1/bid-requests/{bidRequestId}
```

| 상태 | 응답 필드 |
|---|---|
| `RECEIVED` | `bidRequestId`, `auctionId`, `status` |
| `ACCEPTED` | 위 + `currentPrice`, `auctionVersion`, `processedAt`, `extendedEndsAt?` |
| `REJECTED` | 위 + `reason`, `auctionVersion`, `processedAt` |

요청자는 자신의 `bidRequestId`만 조회할 수 있다. 존재하지 않거나 타인 요청은 모두 `404`로 응답해 요청 존재 여부를 노출하지 않는다.

## 4. B. 원자성·이벤트 흐름

```text
HTTP Controller
  → bid_request(RECEIVED) + outbox_event(BidCommandRequested), 같은 DB Transaction
  → Outbox Publisher → bid-command(auctionId key)
  → Bid Worker → Redis Lua / PostgreSQL ledger
  → bid-event(BidAccepted | BidRejected | AuctionExtended)
  → bid_request 상태 갱신 / WebSocket
```

1. Controller는 인증 actor·입력 변환·Use Case 호출만 한다.
2. Use Case는 `bid_request`와 `BidCommandRequested` Outbox를 같은 Transaction으로 저장한다.
3. Broker 확인 전에도 HTTP는 `RECEIVED` 응답만 반환한다.
4. Outbox 재발행은 가능하므로 Worker는 `bidRequestId` 업무 멱등성을 보장한다.
5. `BidAccepted`/`BidRejected` Consumer가 상태를 갱신한다. Kafka Event 순서를 HTTP 응답 순서로 가정하지 않는다.

## 5. I. 오류와 경계

| 상황 | HTTP/처리 | 코드 |
|---|---|---|
| Body·UUID·금액 형식 오류 | 400, Outbox 없음 | `INVALID_BID_REQUEST` |
| 멱등 Key payload 충돌 | 409, 기존 요청 보존 | `IDEMPOTENCY_KEY_PAYLOAD_MISMATCH` |
| 경매가 없거나 타인 조회 | 404 | `NOT_FOUND` |
| Kafka 일시 장애 | 202 유지, Outbox 재발행 | 없음 |
| Worker 가격·상태 거절 | 조회·Event에서 최종 반환 | `BID_TOO_LOW`, `SELF_BID`, `AUCTION_ENDED` 등 |

Controller가 Kafka Producer를 직접 호출하거나, Broker 지연으로 `202`를 `500`으로 바꾸지 않는다.

## 6. T. 검증 계획

| 대상 | 정상 | 오류·경계 |
|---|---|---|
| 접수 | 202 + `RECEIVED` + Outbox 원자 저장 | 형식 오류는 DB·Outbox 없음 |
| 멱등 | 동일 Key/payload는 동일 requestId | 같은 Key/다른 payload는 409 |
| Kafka | `auctionId` Key·계약 payload | Outbox 발행 실패 후 재시도 |
| 조회 | RECEIVED/ACCEPTED/REJECTED 모델 | 타인·없는 ID는 동일 404 |
| 화면 | 재시도에도 requestId 유지 | 늦은 WebSocket/조회 응답이 최신 상태를 되돌리지 않음 |

## 7. 완료 조건

- [x] 202 접수와 최종 결과의 비동기 경계를 확정했다.
- [x] `bidRequestId`·Idempotency-Key·상태 조회 계약을 정의했다.
- [x] PostgreSQL Outbox와 Kafka `auctionId` Key 책임을 정의했다.
- [x] 화면 상태·오류·소유권·멱등 검증 기준을 기록했다.
