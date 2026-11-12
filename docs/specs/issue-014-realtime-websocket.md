# [Issue #77] WebSocket 구독·결과·재연결 사양

- 상태: 제안됨
- 관련 Issue: [#77 WebSocket 구독·결과·재연결 사양 작성](https://github.com/dev-baek/bidflow/issues/77)
- 후속 작업: #78 Spring WebSocket·Redis Pub/Sub, #79 bid-event 실시간 Broadcast Consumer

## 1. 목적과 원칙

WebSocket은 확정된 경매 상태를 빠르게 보여 주는 보조 전달 경로다. 입찰 승인·거절의 최종 근거는 PostgreSQL 원장이고, Redis Pub/Sub과 WebSocket 메시지 유실은 거래 실패가 아니다. Browser는 재연결 또는 버전 공백을 감지하면 REST Snapshot으로 상태를 보정한다.

- Browser는 Redis·Kafka에 직접 연결하지 않는다.
- `bid-event` Outbox가 Kafka에 발행된 뒤에만 실시간 메시지를 만든다.
- 공개 구독에는 자동 최대가, 입찰자 ID, 특정 사용자의 거절 사유를 보내지 않는다.
- 같은 경매 상태는 `auctionVersion`이 단조 증가하는 Snapshot으로 전달한다.

## 2. S. 화면·사용자 흐름

### 2.1 경매 상세 진입

1. Browser가 STOMP 연결 후 `/topic/auctions/{auctionId}`를 구독하고 `receipt`를 요청한다.
2. `RECEIPT`를 받은 뒤 `GET /api/auctions/{auctionId}`로 Snapshot을 조회한다.
3. Reducer는 현재 상태보다 큰 `auctionVersion`만 반영한다. REST가 먼저 또는 WebSocket이 먼저 도착해도 최신 버전이 남는다.
4. 로그인 사용자는 `/user/queue/bid-results`도 함께 구독한다.

구독이 먼저 등록된 뒤 Snapshot을 조회하므로, 구독과 조회 사이의 메시지는 버전 비교로 중복 제거되고 조회 직후 메시지는 정상 반영된다.

### 2.2 입찰 결과

| 수신 위치 | 메시지 | 화면 동작 |
|---|---|---|
| `/topic/auctions/{auctionId}` | `auction.updated` | 현재가·종료 시각·경매 상태 갱신 |
| `/topic/auctions/{auctionId}` | `auction.ended` | 입찰 버튼 비활성화, 종료 상태 표시 |
| `/user/queue/bid-results` | `bid.result` | 내 요청의 승인·거절 Toast와 처리 상태 갱신 |

Browser는 `bidRequestId`가 일치하는 `bid.result`만 해당 제출 상태에 연결한다. 공개 Topic을 보고 자신의 입찰이 승인됐다고 추론하지 않는다.

### 2.3 재연결

연결 종료 시 1초, 2초, 4초, 8초, 이후 최대 10초 간격으로 재시도한다. 재연결 성공 뒤에는 모든 이전 구독을 다시 등록하고 `RECEIPT` 후 REST Snapshot을 다시 조회한다. Snapshot 조회 실패 시 최근 화면 상태를 확정 상태로 표시하지 않고 재시도 안내를 보여 준다.

## 3. D. Browser 계약과 메시지 모델

### 3.1 연결·구독

```text
WebSocket URL: /ws
Protocol: STOMP over WebSocket
CONNECT headers: Authorization: Bearer <access-token>, accept-version: 1.2
SUBSCRIBE destination: /topic/auctions/{auctionId}
SUBSCRIBE destination: /user/queue/bid-results
```

- 서버는 `CONNECT` Header의 Access Token을 검증하고 사용자 ID를 WebSocket Principal로 만든다.
- `/topic/auctions/{auctionId}`는 인증 사용자만 구독할 수 있다. 존재하지 않거나 조회 권한이 없는 경매는 `ERROR` Frame으로 거절한다.
- `/user/**` destination은 Principal과 일치하는 Session에만 전달한다. Browser가 다른 사용자 ID를 destination에 넣을 수 없다.

### 3.2 공개 경매 상태

Destination은 `/topic/auctions/{auctionId}`이고, payload는 다음과 같다.

```json
{
  "type": "auction.updated",
  "eventId": "UUID",
  "auctionId": "UUID",
  "auctionVersion": 42,
  "occurredAt": "2030-01-01T12:00:00Z",
  "currentPrice": 135000,
  "endsAt": "2030-01-01T12:05:00Z",
  "status": "ACTIVE"
}
```

`auction.ended`는 위 필드에 `status: "ENDED"`와 `outcome: "SOLD" | "UNSOLD"`를 추가한다. `winnerId`, 자동 최대가, `bidRequestId`, 거절 사유는 공개 메시지에 포함하지 않는다.

### 3.3 개인 입찰 결과

Destination은 `/user/queue/bid-results`이고, 결과를 낸 사용자에게만 보낸다.

```json
{
  "type": "bid.result",
  "eventId": "UUID",
  "bidRequestId": "UUID",
  "auctionId": "UUID",
  "auctionVersion": 42,
  "occurredAt": "2030-01-01T12:00:00Z",
  "decision": "ACCEPTED",
  "reason": null,
  "currentPrice": 135000,
  "endsAt": "2030-01-01T12:05:00Z",
  "isHighestBidder": true
}
```

- `decision`은 `ACCEPTED` 또는 `REJECTED`다.
- 거절 때 `reason`은 `BID_TOO_LOW`, `SELF_BID`, `AUCTION_ENDED`, `AUCTION_NOT_STARTED` 중 하나이며 `currentPrice`는 마지막 확정 가격이다.
- `isHighestBidder`는 결과 수신자 자신 기준 boolean이다. 다른 사용자의 승자 식별자는 공개하지 않는다.
- `eventId`는 Kafka Outbox의 event ID를 그대로 사용한다. Browser는 최근 event ID를 짧게 보관해 중복 Frame을 무시한다.

### 3.4 REST Snapshot

```text
GET /api/auctions/{auctionId}
```

REST 응답은 `auctionId`, `auctionVersion`, `currentPrice`, `endsAt`, `status`, `serverTime`을 가진다. `serverTime`은 남은 시간 표시를 위한 기준이며 Browser 로컬 시간은 거래 판단에 쓰지 않는다. Browser Reducer는 Snapshot도 WebSocket과 동일하게 더 큰 버전일 때만 적용한다. 종료 상태처럼 같은 버전의 보완 필드는 `status`가 더 종료 쪽 상태일 때만 갱신한다.

## 4. B. Spring WebSocket·Redis Pub/Sub 경계

```text
Kafka bid-event
  → Realtime Projection Consumer
  → PostgreSQL Auction Snapshot 조회
  → Redis channel: realtime.auction.{auctionId}
  → 모든 API 인스턴스의 Redis Subscriber
  → 각 인스턴스가 보유한 STOMP Session으로 전송
```

- Spring은 STOMP Endpoint `/ws`, Application Prefix `/app`, Broker Prefix `/topic`, `/queue`를 설정한다.
- `SimpMessagingTemplate`은 Redis Subscriber가 받은 메시지를 로컬 Session으로 fan-out한다.
- Redis Channel은 인스턴스 간 전달 전용이다. Pub/Sub을 원장이나 재생 Queue로 사용하지 않는다.
- Kafka Consumer 또는 Redis Subscriber 전송 실패는 입찰 Transaction을 롤백하지 않는다. 오류는 로그·메트릭으로 관측하고 Browser는 REST로 복구한다.
- API 인스턴스가 한 대여도 Redis Pub/Sub 경로를 유지한다. ALB가 다른 인스턴스로 WebSocket을 연결해도 동일한 Contract가 성립한다.

## 5. I. 이벤트 변환·순서·장애

| Kafka event | 공개 메시지 | 개인 메시지 | 처리 |
|---|---|---|---|
| `BidAccepted` | `auction.updated` | 요청자에게 `bid.result(ACCEPTED)` | DB Snapshot으로 현재가·종료 시각·버전 구성 |
| `BidRejected` | 없음 | 요청자에게 `bid.result(REJECTED)` | 원장 결과와 DB Snapshot으로 구성 |
| `AuctionExtended` | `auction.updated` | 없음 | 같은 version의 중복은 eventId로 제거 |
| `AuctionEnded` | `auction.ended` | 없음 | 종료 Snapshot 전송 |

`BidAccepted`와 `AuctionExtended`는 같은 경매 버전을 가질 수 있다. Projection은 각 Kafka event를 독립적으로 처리하되, Browser는 `eventId` 중복 제거와 `auctionVersion` 단조 적용으로 최종 Snapshot에 수렴한다. Projection이 이전 버전 event를 받으면 현재 DB Snapshot의 더 큰 버전을 전송할 수 있으며, Browser는 이를 그대로 적용한다.

Redis Pub/Sub 메시지를 받지 못한 인스턴스 또는 연결이 끊긴 Browser는 저장된 offset이나 Redis 재생을 시도하지 않는다. 재연결한 Browser의 REST Snapshot이 복구 기준이다.

## 6. T. 검증 계획

| 대상 | 정상 | 경계·장애 |
|---|---|---|
| STOMP 인증 | 유효 Token CONNECT·구독 | 누락/만료 Token, 타인 `/user/**` 구독 거절 |
| 공개 메시지 | 가격·종료 시각·버전 fan-out | 최대가·입찰자 ID·거절 사유 미노출 |
| 개인 메시지 | 요청자에게 승인·거절 전달 | 다른 Session에 전달되지 않음 |
| 버전 Reducer | 큰 버전 Snapshot 반영 | 중복 eventId, 작은 버전, 같은 버전 순서 역전 무시 |
| 재연결 | Backoff 뒤 구독·REST 보정 | Redis Pub/Sub 유실, Socket 종료, REST 일시 실패 |
| 다중 인스턴스 | 한 인스턴스 publish → 다른 인스턴스 Session 수신 | Subscriber 재시작 뒤 REST 복구 |

## 7. 완료 조건

- [x] STOMP 연결·구독·인증·공개/개인 destination 계약을 정의했다.
- [x] 입찰·연장·종료 이벤트의 WebSocket 변환 규칙을 정의했다.
- [x] `auctionVersion`·event ID·REST Snapshot으로 중복·순서 역전·유실을 보정하는 방식을 정의했다.
- [x] Redis Pub/Sub과 PostgreSQL 원장의 책임 경계를 정의했다.
- [x] 다음 구현 Issue의 정상·보안·장애 검증 기준을 정의했다.
