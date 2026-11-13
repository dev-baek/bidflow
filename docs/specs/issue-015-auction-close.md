# [Issue #80] PostgreSQL 잠금 기반 경매 종료 사양

- 상태: 제안됨
- 관련 Issue: [#80 PostgreSQL 잠금 기반 경매 종료 Scheduler 구현](https://github.com/dev-baek/bidflow/issues/80)

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

## 7. 완료 조건

- [x] PostgreSQL 최신 종료 시각과 Redis의 책임 경계를 정의했다.
- [x] 최고 입찰자·낙찰/유찰 데이터 모델을 정의했다.
- [x] 잠금·결과·Outbox의 원자 Transaction을 정의했다.
- [x] 자동 연장·다중 Worker·재실행 검증 기준을 정의했다.
