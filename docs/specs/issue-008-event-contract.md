# [Issue #8] Kafka 토픽과 이벤트 계약 사양

- 상태: 제안됨
- 작성일: 2026-11-12
- 관련 Issue: [#8 Kafka 토픽과 이벤트 계약 정의](https://github.com/dev-baek/bidflow/issues/8)
- 선행 결정: [Kafka와 SQS 비교 ADR](./issue-029-kafka-sqs-decision-adr.md)
- 구현 선행 조건: 이 문서의 PR 병합

## 1. 목적과 범위

Producer와 Consumer가 독립적으로 개발될 수 있도록 Kafka Topic, 공통 Envelope, Key, Payload의 최소 계약과 호환성 규칙을 정의한다. 이 문서는 화면을 구현하지 않으며, 실제 Topic 생성과 Broker 설정은 후속 #53에서 구현한다.

### S. 화면

해당 없음. Kafka Event는 Browser에 직접 노출되지 않는다. 입찰 접수·처리 대기·승인·거절 화면 상태는 후속 입찰 API와 WebSocket 사양에서 정의한다.

## 2. 공통 원칙

- 전달은 At-least-once로 가정한다. 중복 Event는 발생할 수 있다.
- `eventId`는 Consumer 멱등 처리의 식별자다.
- `correlationId`는 HTTP 요청, Outbox, Kafka, Worker 로그를 연결한다.
- 순서 보장은 Topic 전체가 아니라 같은 Partition 안에서만 적용된다.
- 순서가 필요한 입찰 명령과 경매 이벤트는 `auctionId`를 Kafka Key로 사용한다.
- 검색 Projection처럼 상품 문서가 대상인 Event는 `productId`를 Key로 사용한다.
- Domain은 Kafka API와 JSON 직렬화 라이브러리를 참조하지 않는다. Topic 발행·수신은 Adapter의 효과 경계다.

## 3. D. 데이터 계약

### 3.1 공통 Envelope

모든 Kafka Value는 다음 Envelope를 사용한다. 현재 `event-contract` 모듈의 `EventEnvelope<T>`와 필드명이 일치해야 한다.

```json
{
  "eventId": "b9347c5f-b02f-4a67-89c9-2d2272ed1a32",
  "eventType": "BidCommandRequested",
  "schemaVersion": 1,
  "occurredAt": "2026-11-12T00:00:00Z",
  "correlationId": "request-1",
  "payload": {}
}
```

| 필드 | 타입 | 규칙 |
|---|---|---|
| `eventId` | UUID | Producer가 한 번 생성하며 Consumer 멱등 Key로 사용 |
| `eventType` | String | 아래 계약의 정확한 이름 사용 |
| `schemaVersion` | Integer | 1 이상, 호환성 판단에 사용 |
| `occurredAt` | ISO-8601 UTC Instant | Producer가 명시적으로 전달 |
| `correlationId` | String | 최초 요청 또는 Batch 실행의 추적 ID, 공백 불가 |
| `payload` | Object | Event Type별 필수 필드 충족 |

`eventId`와 `bidRequestId`는 다르다. `eventId`는 전달 단위 식별자이고, `bidRequestId`는 사용자의 입찰 요청을 재시도해도 바뀌지 않는 업무 식별자다.

### 3.2 Topic과 Payload

| Topic | Event Type | Key | Producer | Consumer | Payload 필수 필드 |
|---|---|---|---|---|---|
| `bid-command` | `BidCommandRequested` | `auctionId` | Outbox Publisher | Bid Worker | `bidRequestId`, `auctionId`, `bidderId`, `bidKind`, `amount`, `requestedAt` |
| `bid-event` | `BidAccepted` | `auctionId` | Bid Worker Outbox Publisher | Realtime Projection, Analytics Projection | `bidRequestId`, `auctionId`, `bidderId`, `currentPrice`, `auctionVersion`, `processedAt` |
| `bid-event` | `BidRejected` | `auctionId` | Bid Worker Outbox Publisher | Realtime Projection, Analytics Projection | `bidRequestId`, `auctionId`, `bidderId`, `reason`, `auctionVersion`, `processedAt` |
| `bid-event` | `AuctionExtended` | `auctionId` | Bid Worker Outbox Publisher | Realtime Projection, Search Projection | `auctionId`, `previousEndsAt`, `extendedEndsAt`, `auctionVersion` |
| `bid-event` | `AuctionEnded` | `auctionId` | Scheduler Outbox Publisher | Realtime Projection, Search Projection, Analytics Projection | `auctionId`, `outcome`, `winnerId`, `finalPrice`, `auctionVersion`, `endedAt` |
| `listing-event` | `ListingPublished` | `productId` | Listing Outbox Publisher | Search Projection, Analytics Projection | `productId`, `sellerId`, `title`, `categoryId`, `publishedAt`, `listingVersion` |
| `listing-event` | `ListingUpdated` | `productId` | Listing Outbox Publisher | Search Projection, Analytics Projection | `productId`, `title`, `categoryId`, `listingVersion`, `updatedAt` |
| `listing-event` | `ListingUnpublished` | `productId` | Listing Outbox Publisher | Search Projection | `productId`, `listingVersion`, `unpublishedAt` |

`bidKind`은 `DIRECT` 또는 `AUTO_MAX`이다. 금액은 부동소수점이 아닌 최소 화폐 단위 정수로 전달한다. `reason`은 안정적인 기계 코드이며 표시 문구는 Consumer가 Event에 넣지 않는다. `winnerId`는 유찰이면 `null`일 수 있지만 `outcome`은 반드시 존재한다.

Payload의 추가 필드는 허용하지만 기존 필드의 삭제, 이름 변경, 타입 변경, 의미 변경은 허용하지 않는다.

### 3.3 저장과 멱등 기록

| 저장소 | 기록 | 목적 |
|---|---|---|
| PostgreSQL Outbox | Event Envelope, Topic, Key, 발행 상태 | DB 변경과 발행 대상의 원자적 기록 |
| PostgreSQL Consumer 처리 기록 | Consumer Group, `eventId`, 처리 시각 | 중복 Event의 외부 효과 방지 |
| PostgreSQL 입찰 요청 | `bidRequestId`, 처리 결과 | 같은 사용자 요청의 업무 멱등성 |

Consumer 처리 기록은 Consumer Group별로 분리한다. Search Projection이 처리한 Event가 Realtime Projection에서 자동으로 처리된 것으로 간주되면 안 된다.

## 4. B. Producer와 Consumer 동작

### 4.1 Producer

1. 업무 Transaction에서 원장 변경과 Outbox Row를 함께 저장한다.
2. Outbox Publisher가 Topic, Key, Envelope를 Kafka에 발행한다.
3. Kafka Broker 확인 뒤 Outbox Row를 발행 완료 상태로 갱신한다.
4. Publisher가 중단되면 같은 Outbox Row를 다시 발행할 수 있다.

HTTP Controller나 Domain 함수가 Kafka Producer를 직접 호출하지 않는다. 이중 쓰기 실패를 피하기 위해 Event는 Outbox를 통해서만 발행한다.

### 4.2 Consumer

1. Envelope와 `schemaVersion`을 검증한다.
2. Consumer Group별 `eventId` 처리 여부를 확인한다.
3. 처리하지 않은 Event의 외부 효과를 실행한다.
4. 처리 기록을 저장한다.
5. 처리 기록과 외부 효과가 성공한 뒤 Kafka Offset을 Commit한다.

처리 중 예외가 나면 Offset을 Commit하지 않는다. 재소비된 Event는 멱등 처리한다. 재시도 한도를 넘은 Event는 격리 Topic 또는 재처리 저장소로 보낸다. 격리 방식의 구체 구현은 Consumer 장애 이슈에서 확정한다.

## 5. I. 로컬 Kafka 정책

| Topic | 초기 Partition 수 | Replication Factor | 보존 정책 | 이유 |
|---|---:|---:|---|---|
| `bid-command` | 3 | 1 | 7일 | `auctionId`별 순서와 서로 다른 경매의 병렬 처리 |
| `bid-event` | 3 | 1 | 7일 | 실시간·검색·통계 Consumer의 독립 처리와 단기 재생 |
| `listing-event` | 3 | 1 | 7일 | 상품별 순서와 Search 재처리 |

로컬 단일 Kafka Broker에서는 Replication Factor를 1로 둔다. 이는 내결함성 구성이 아니라 개발 환경의 제약이다. AWS 이전 시 Replication Factor, 보존 기간, Partition 수는 실제 처리량·Consumer Lag·비용을 측정해 별도 검토한다.

Topic 생성은 애플리케이션 기동 시 자동 생성하지 않는다. Compose 초기화 작업 또는 명시적 관리 명령이 Topic 이름·Partition 수·보존 설정을 적용하고, 검증 스크립트가 실제 설정을 확인한다.

## 6. T. 계약 검증

| 검증 | 정상 | 오류·경계 |
|---|---|---|
| Envelope | 유효한 UUID·Type·Version·시간·Payload 수락 | 빈 Type, 0 Version, 미래 시간, 누락 Payload 거절 |
| 호환성 | 신규 선택 필드를 추가한 v1 Event 수신 | 기존 필드 삭제·이름/타입/의미 변경은 계약 Test 실패 |
| Key | 같은 `auctionId`가 같은 Partition | Key 누락 Event는 순서 보장이 필요한 Topic에서 거절 |
| 멱등 Consumer | 같은 `eventId` 재수신 시 외부 효과 한 번 | 처리 실패 Event는 Offset 미커밋·재시도 |
| Consumer Group | Search·Realtime Group이 같은 Event를 각각 처리 | 한 Group의 처리 기록이 다른 Group을 건너뛰지 않음 |
| Topic 정책 | 세 Topic의 Partition·보존·복제 설정 일치 | 누락 Topic·다른 Partition 설정은 검증 실패 |

Domain과 `event-contract` 모듈의 단위 테스트는 Docker 없이 실행한다. Kafka Topic·Producer·Consumer의 연결은 로컬 Docker 또는 Testcontainers 통합 테스트로 검증한다.

## 7. 스키마 호환성 정책

1. 같은 Major 계약에서는 Payload에 선택 필드만 추가한다.
2. Consumer는 모르는 선택 필드를 무시한다.
3. 필수 필드를 추가하려면 기본값을 가진 선택 필드로 먼저 배포하고, 모든 Consumer 전환 뒤 새 Version을 사용한다.
4. 필드 삭제·이름 변경·타입 변경·단위 변경·의미 변경은 새 Event Type 또는 새 `schemaVersion`을 만든다.
5. Producer는 새 Version을 발행하기 전에 필요한 Consumer가 해당 Version을 처리할 수 있는지 계약 Test로 확인한다.
6. 지원 종료된 Version은 보존 기간과 Consumer Lag을 확인한 뒤에만 제거한다.

## 8. 완료 조건

- [x] S 제외 이유와 D/B/I/T 계약이 기록됐다.
- [x] 모든 Topic의 Producer, Consumer, Key, Payload 필수 필드가 정의됐다.
- [x] 동일 경매의 순서 보장 범위가 `auctionId` Key와 Partition으로 명시됐다.
- [x] At-least-once·Outbox·Consumer 멱등 처리 경계가 정의됐다.
- [x] 로컬 Topic 정책과 AWS 이전 검토 조건이 기록됐다.
- [x] 호환성·중복·순서·Topic 정책 계약 Test 사례가 정의됐다.
