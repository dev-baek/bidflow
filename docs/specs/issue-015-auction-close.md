# [Issue #81] 경매 종료·낙찰·보정 처리 사양

- 상태: 제안됨
- 관련 Issue: [#81 경매 종료·낙찰·보정 처리 사양 작성](https://github.com/dev-baek/bidflow/issues/81)
- 구현 Issue: #80 종료 Scheduler, #82 종료 보정 테스트, #83 낙찰·유찰 확정 Consumer, #86 Redis 활성 상태 재구성

## 1. 목적과 원칙

경매 종료는 Redis TTL이나 Browser 시간을 기준으로 하지 않는다. Scheduler가 PostgreSQL의 최신 `auction.ends_at`을 조회하고, 같은 Transaction에서 종료 상태·낙찰 결과·`AuctionEnded` Outbox를 확정한다. Redis는 활성 계산 상태일 뿐 종료 원장이 아니다.

## 2. S. 사용자 결과

`endsAt <= serverTime`인 `ACTIVE` 경매는 다음 Polling 이후 `ENDED`로 보인다. 최고 입찰자가 있으면 낙찰(`SOLD`), 없으면 유찰(`UNSOLD`)이다. Browser는 `AuctionEnded` WebSocket 메시지를 받거나 재연결 뒤 REST Snapshot으로 종료 상태를 확인한다.

## 3. D. PostgreSQL 상태

| 필드/테이블 | 책임 |
|---|---|
| `auction.current_winner_id` | 마지막 Redis Lua 승인 결과의 최고 입찰자. 자동 최대가는 저장하지 않는다. |
| `auction.current_price` | 공개 현재가. |
| `auction_result` | 종료 뒤 변경되지 않는 SOLD/UNSOLD 결과. |
| `outbox_event` | `AuctionEnded`의 내구성 있는 발행 대기 Row. |

`current_winner_id`가 비어 있으면 `UNSOLD`이고, 있으면 `SOLD(current_winner_id, current_price)`다. 승인 입찰 Transaction은 `current_price`, `current_winner_id`, `ends_at`, `version`을 함께 갱신한다.

## 4. B. 종료 Transaction

```text
Scheduler(now)
  → select ACTIVE where ends_at <= now order by ends_at for update skip locked limit N
  → 각 행의 current_winner_id·current_price로 outcome 계산
  → auction: ACTIVE → ENDED, version + 1
  → auction_result insert
  → AuctionEnded Outbox insert
  → commit
```

- `FOR UPDATE SKIP LOCKED`로 여러 Scheduler가 같은 경매를 동시에 선택하지 않는다.
- 잠금 이후 최신 `ends_at`을 다시 기준으로 사용한다. 자동 연장 Transaction이 먼저 커밋했다면 해당 행은 다음 Polling까지 선택되지 않는다.
- `auction_result`의 PK와 `AuctionEnded` Outbox 생성은 동일 Transaction에 있다. 재실행은 이미 `ENDED`인 행을 선택하지 않으므로 추가 결과·이벤트를 만들지 않는다.
- 종료 중 DB 오류가 나면 Transaction 전체가 롤백되고 다음 Polling이 재시도한다.

## 5. I. 이벤트 계약

```json
{
  "auctionId": "UUID",
  "outcome": "SOLD",
  "winnerId": "Cognito subject 또는 null",
  "finalPrice": 13000,
  "auctionVersion": 9,
  "endedAt": "2030-01-01T12:00:00Z"
}
```

`winnerId`와 `finalPrice`는 `SOLD`일 때만 존재한다. `UNSOLD`에는 두 필드를 JSON `null`로 기록한다. WebSocket 공개 메시지는 `outcome`만 포함하고 낙찰자 식별자는 포함하지 않는다.

## 6. T. 검증 계획

| 대상 | 정상 | 경계·장애 |
|---|---|---|
| 종료 대상 | `ACTIVE`·`ends_at <= now` 선택 | 연장된 `ends_at > now` 미선택 |
| 다중 Worker | 두 Worker 중 한 쪽만 종료 | `SKIP LOCKED`로 중복 Result/Outbox 없음 |
| 낙찰/유찰 | winner 존재 시 SOLD | winner 없음 시 UNSOLD, null 결과 필드 |
| 원자성 | auction·result·outbox 함께 저장 | 버전/DB 오류 시 모두 롤백 |
| 재실행 | 다음 Polling에서 0건 | 추가 낙찰자·이벤트 없음 |

## 7. 보정·재시도·Redis 정리

### 7.1 지연 Polling과 중복 호출

Scheduler는 정확한 종료 시각에 실행되는 예약기가 아니다. Polling 지연·배포·DB 일시 오류 뒤의 다음 실행이 `ends_at <= now`를 다시 조회해 늦은 종료를 보정한다. 지연 시간은 사용자 화면의 일시적 `ACTIVE` 표시만 만들 수 있으며, 종료 결과·가격·낙찰자를 바꾸지 않는다.

| 관측 상태 | 보정 주체 | 결과 |
|---|---|---|
| `ACTIVE`, `ends_at <= now`, 결과 없음 | Scheduler | 잠금 뒤 종료 Transaction 실행 |
| `ENDED`, `auction_result` 존재 | Scheduler 재실행 | 0건, 상태 불변 |
| `ENDED`, Outbox 미발행 | Outbox Publisher | 같은 `eventId` 재발행 가능 |
| 종료 Transaction 롤백 | 다음 Scheduler Polling | 같은 ACTIVE 행을 다시 선택 |
| Redis에 활성 Key 잔존 | AuctionEnded Consumer/복구 Worker | 해당 `auctionId` Key 삭제 또는 ENDED Snapshot으로 교체 |

`auction_result`가 있으나 `auction.status != ENDED`인 상태는 정상 Transaction으로 만들 수 없다. 운영 점검에서 발견하면 임의 재낙찰하지 않고 PostgreSQL 원장·Outbox를 확인한 뒤 복구 명령으로만 처리한다.

### 7.2 종료 이후 입찰 명령

PostgreSQL `ENDED`가 최종 우선순위다. Redis Key를 아직 정리하지 못한 짧은 구간에 Lua가 승인한 결과가 있어도, 원장 Transaction은 종료된 경매의 버전·상태 검증에서 실패하고 Kafka offset을 커밋하지 않는다. #86 복구 Worker는 해당 경매가 `ENDED`임을 확인해 Redis Key를 제거하고 남은 명령을 `AUCTION_ENDED` 결과로 수렴시킨다. 종료 뒤에는 새 입찰 원장·가격·낙찰자를 만들지 않는다.

### 7.3 낙찰·유찰 Consumer

`AuctionEnded` Consumer는 Outbox event ID를 멱등 키로 사용한다. 다음 효과는 반복되어도 같은 최종 상태여야 한다.

1. Redis 활성 경매 `state`, `auto`, `processed` Key를 제거한다.
2. Search Projection을 종료 상태로 색인한다.
3. Realtime Projection이 공개 `auction.ended`를 전파한다.

Consumer가 한 효과 뒤 실패해 이벤트를 다시 받더라도 PostgreSQL 낙찰 결과는 다시 만들지 않으며, Redis 삭제·검색 색인·WebSocket 전파는 멱등하게 허용한다. WebSocket 유실은 Browser REST Snapshot이 보정한다.

### 7.4 자동 연장과 종료 경쟁

승인 입찰의 연장 Transaction과 종료 Scheduler는 같은 `auction` 행을 잠근다. 먼저 커밋한 Transaction의 `ends_at`·`version`이 다음 Transaction의 기준이다.

```text
연장 먼저 commit → ends_at > now → Scheduler는 종료 대상에서 제외
종료 먼저 lock/commit → status ENDED → 입찰 원장 Transaction은 상태·version 불일치로 rollback
```

이 규칙은 종료 직전의 입찰을 조용히 덮어쓰지 않는 대신, 늦게 처리된 명령을 재시도 가능한 실패로 남긴다. Browser의 확정 표시는 항상 PostgreSQL Snapshot과 `AuctionEnded` 이벤트를 따른다.

## 8. T. 보정 검증 추가 기준

| 시나리오 | 기대 결과 |
|---|---|
| Scheduler가 1분 늦게 실행 | 한 번의 종료 결과·Outbox 생성 |
| 같은 종료 명령 반복 | Result·AuctionEnded Outbox 수 1 |
| 종료 뒤 Outbox Publisher 실패 | DB 종료 상태 불변, 같은 event ID 재발행 |
| 종료 후 Redis Key 잔존 | Consumer/복구가 Key 제거, 새 승인 원장 없음 |
| 연장과 종료 동시 실행 | 먼저 잠근 최신 DB 상태에 따라 연장 또는 종료 하나만 확정 |
| UNSOLD event | `winnerId`, `finalPrice` null, 공개 화면은 유찰만 표시 |

## 9. 완료 조건

- [x] PostgreSQL 최신 종료 시각과 Redis의 책임 경계를 정의했다.
- [x] 최고 입찰자·낙찰/유찰 데이터 모델을 정의했다.
- [x] 잠금·결과·Outbox의 원자 Transaction을 정의했다.
- [x] 자동 연장·다중 Worker·재실행 검증 기준을 정의했다.
- [x] 지연 Polling·Outbox 재발행·Redis 잔존 상태의 보정 책임을 정의했다.
- [x] 종료 이후 명령과 연장/종료 경쟁의 최종 우선순위를 정의했다.
