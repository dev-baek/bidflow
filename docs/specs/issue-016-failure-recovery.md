# [Issue #84] 이벤트 재시도·격리·상태 복구 사양

- 상태: 제안됨
- 관련 Issue: [#84 이벤트 재시도·격리·상태 복구 사양 작성](https://github.com/dev-baek/bidflow/issues/84)
- 후속 작업: #85 Consumer eventId 멱등·실패 격리, #86 Redis 활성 경매 상태 재구성

## 1. 목적과 원칙

Kafka 전달은 at-least-once다. 따라서 “같은 이벤트가 다시 올 수 있음”을 정상 경로로 취급한다. 재시도는 일시적 오류를 회복하기 위한 것이고, 잘못된 계약·업무 불변식 위반을 무한 반복하는 수단이 아니다. PostgreSQL 원장과 `consumer_event`가 멱등 처리 근거이고, Redis·OpenSearch·WebSocket은 복구 가능한 파생 상태다.

```text
Kafka event
  → Consumer contract 검증
  → consumer_event(eventId, consumerName) 멱등 확인
  → 효과 적용
  → 처리 기록 / offset commit
```

같은 eventId를 다시 받으면 효과를 다시 만들지 않고 성공으로 처리한다. 단, Redis Key 삭제처럼 본질적으로 멱등인 효과도 consumer_event 기록을 남겨 관측·감사를 가능하게 한다.

## 2. S. 운영자·사용자 결과

| 상황 | 사용자 표시 | 운영자 조치 |
|---|---|---|
| 일시적 DB/Redis/Kafka 오류 | 입찰은 `PENDING` 또는 최근 확정 상태 유지 | 자동 재시도 관측 |
| 계약 위반 이벤트 | 해당 화면의 확정 상태는 REST Snapshot 유지 | DLT 원인 분석·수정 뒤 Replay |
| Redis 활성 상태 유실 | 해당 경매 입찰은 잠시 처리 대기 | PostgreSQL Snapshot 재구성 |
| WebSocket 유실 | 최신가가 잠시 늦음 | Browser 재연결 뒤 REST Snapshot 보정 |

DLT는 사용자에게 직접 노출하지 않는다. 입찰 결과를 추측하지 않고, PostgreSQL `bid_request`/경매 조회 API가 최종 화면 기준이다.

## 3. D. 실패·멱등 데이터

### 3.1 Consumer 처리 기록

```text
consumer_event
├── consumer_name varchar(64)
├── event_id uuid
├── processed_at timestamptz
├── source_topic varchar(64)
├── source_partition integer
└── source_offset bigint

PK (consumer_name, event_id)
```

- 영속 상태를 변경하는 Consumer는 업무 변경과 `consumer_event` insert를 같은 PostgreSQL Transaction으로 저장한다.
- `unique conflict`는 이미 처리한 event로 판단해 성공 처리한다.
- 파생 효과 Consumer는 같은 처리 기록으로 중복 전파를 줄인다. Redis 삭제·검색 upsert는 기록 누락 상태에서 재실행해도 안전해야 한다.

### 3.2 DLT 메시지

원본 topic마다 `<topic>.DLT`를 둔다. DLT payload는 원본 EventEnvelope를 변경하지 않고, Kafka Header에 다음 진단 정보를 추가한다.

| Header | 값 |
|---|---|
| `x-original-topic` | 원본 topic |
| `x-original-partition` | 원본 partition |
| `x-original-offset` | 원본 offset |
| `x-failure-class` | `TRANSIENT_EXHAUSTED`, `CONTRACT_INVALID`, `BUSINESS_INVARIANT` |
| `x-exception-type` | 예외 클래스 |
| `x-exception-message` | 정제된 오류 메시지 |
| `x-failed-at` | UTC 시각 |

원본 `eventId`, `correlationId`는 payload 그대로 유지한다. Replay가 새 event ID를 만들면 consumer 멱등성을 우회하므로 금지한다.

## 4. B. 오류 분류와 재시도 정책

| 분류 | 예시 | 자동 재시도 | 최종 처리 |
|---|---|---|---|
| `TRANSIENT` | DB connection timeout, Redis 연결 오류, OpenSearch 5xx, Kafka 일시 오류 | 초기 1초, 2초, 4초 총 3회 | 소진 시 DLT |
| `CONTRACT_INVALID` | JSON parse 실패, 필수 payload 누락, topic/key 불일치 | 없음 | 즉시 DLT |
| `BUSINESS_INVARIANT` | 종료된 경매에 승인 원장 저장, 버전 불일치, Snapshot 불일치 | 없음 | 즉시 DLT + 원장 점검 |
| `REDIS_RECOVERABLE` | `NOT_ACTIVE`, 활성 state Key 유실 | Redis 재구성 1회 뒤 같은 명령 재실행 | 재구성 실패 시 재시도 가능한 예외 |

- Consumer는 예외를 삼키거나 로그만 남기고 성공 반환하지 않는다.
- `TRANSIENT`의 마지막 실패와 즉시 격리 분류만 DLT로 보낸 뒤 해당 offset을 진행한다.
- `REDIS_RECOVERABLE`은 DLT로 보내기 전에 #86의 단일 경매 재구성을 수행한다. PostgreSQL에서 `ENDED`이면 재구성하지 않고 `AUCTION_ENDED`로 수렴한다.
- DLT publish 자체가 실패하면 원본 offset을 커밋하지 않는다.

## 5. I. Replay·복구 흐름

### 5.1 DLT 수동 Replay

1. 운영자가 DLT Header와 PostgreSQL 원장으로 실패 원인을 분류한다.
2. 코드·데이터·외부 서비스 원인이 해결됐는지 확인한다.
3. Replay 도구가 원본 EventEnvelope와 eventId를 그대로 원본 topic에 발행한다. 새 Header에는 `x-replay-id`, `x-replayed-at`, `x-replayed-by`만 추가한다.
4. Consumer의 `consumer_event`를 확인한다. 이미 성공 처리된 event는 다시 효과를 만들지 않는다.
5. 성공 시 DLT 원본은 삭제하지 않고 `replayed_at`, `replay_result` 운영 기록으로 종료한다.

자동 DLT 재발행은 금지한다. 계약 오류나 업무 불변식은 원인을 수정하지 않으면 다시 DLT로 돌아오기 때문이다.

### 5.2 Redis 활성 경매 재구성

```text
Bid Worker가 NOT_ACTIVE 수신
  → PostgreSQL auction 조회
  → ENDED/CANCELLED: Redis Key 제거, AUCTION_ENDED 결과
  → ACTIVE: currentPrice, currentWinner, version, endsAt로 state 재구축
  → 자동 최대가/처리 결과를 원장에서 재구축
  → 원래 Kafka command를 다시 Lua 처리
```

재구성은 전체 Redis flush나 전체 경매 일괄 재구축이 아니라 `auctionId` 하나로 제한한다. 같은 경매의 복구 경합은 PostgreSQL row lock 또는 Redis 분산 lock 중 하나를 후속 구현에서 사용해 중복 Snapshot을 방지한다.

## 6. T. 검증 계획

| 대상 | 정상 | 오류·경계 |
|---|---|---|
| Consumer 멱등 | 같은 eventId 재소비 시 효과 1회 | 서로 다른 consumerName은 독립 처리 |
| 재시도 | 세 번째 이전 일시 오류 회복 | 세 번 소진 시 DLT 한 건 |
| 계약 격리 | 유효 event 처리 | parse/key/payload 오류 즉시 DLT, 무한 재시도 없음 |
| DLT publish | 원본 eventId 보존 | DLT 발행 실패 시 offset 미커밋 |
| Replay | 수정 후 같은 eventId 재발행 | 이미 처리한 event는 효과 중복 없음 |
| Redis 복구 | ACTIVE state 재구축 뒤 명령 처리 | ENDED 상태는 재구축 금지·Redis Key 제거 |
| 관측 | retry/DLT/replay metric·로그 | correlationId로 원본-재시도-DLT 추적 |

## 7. 완료 조건

- [x] 재시도 가능·즉시 격리·Redis 복구 오류를 분류했다.
- [x] Consumer eventId 멱등 데이터와 Transaction 경계를 정의했다.
- [x] DLT payload/Header·수동 Replay 절차를 정의했다.
- [x] Redis 유실 시 단일 경매 재구성·종료 상태 처리 기준을 정의했다.
- [x] 다음 구현의 정상·장애·운영 검증 기준을 정의했다.
