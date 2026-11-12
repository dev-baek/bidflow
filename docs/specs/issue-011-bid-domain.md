# [Issue #62] 직접·자동 입찰 가격 규칙 사양

- 상태: 제안됨
- 작성일: 2026-11-12
- 관련 Issue: [#62 직접·자동 입찰 가격 규칙 사양 작성](https://github.com/dev-baek/bidflow/issues/62)
- 후속 작업: #64 최소 입찰 단위, #65 가격·승자 계산, #66 속성 기반 테스트, #73/#75 Redis Lua

## 1. 목적과 원칙

입찰 금액은 최소 화폐 단위 정수(`long`)만 사용한다. 가격 계산은 외부 I/O 없이 같은 입력에 같은 출력을 내는 순수 함수로 구현하고, Redis·Kafka·PostgreSQL은 계산 결과를 저장·전달하는 효과 경계로 둔다.

동일 경매의 최종 승인 순서는 `auctionId` Kafka Key와 Redis Lua Script의 단일 실행으로 결정한다. Browser 요청 도착 순서나 서버 여러 대의 시계는 순서 기준이 아니다.

## 2. S. 입찰 화면 계약

| 입력 | Browser 선검증 | 서버 최종 기준 |
|---|---|---|
| 직접 입찰가 | 현재가 + 최소 단위 이상인 정수 | Redis 원자 계산 시점의 현재가 기준 |
| 자동 최대가 | 직접 입찰가와 같은 정수 조건 | 최대가를 원장·Redis에 저장, 공개는 현재가만 |
| 제출 | 요청 중 중복 클릭 차단 | `bidRequestId`로 업무 멱등 처리 |

승인 결과에는 현재가·최고 입찰자 본인 여부·연장된 종료 시각을 표시한다. 거절 결과에는 안정적인 `reason` 코드만 보내고 표시 문구는 Browser가 결정한다.

## 3. D. 가격 규칙

### 3.1 최소 입찰 단위

| 현재가 구간(원) | 최소 단위(원) |
|---:|---:|
| 1,000 ~ 99,999 | 1,000 |
| 100,000 ~ 499,999 | 5,000 |
| 500,000 ~ 999,999 | 10,000 |
| 1,000,000 이상 | 50,000 |

`minimumNextPrice(currentPrice) = currentPrice + incrementFor(currentPrice)`이다. 요청 금액은 이 값 이상이어야 하며, 금액 상한은 별도 정책이 생기기 전까지 두지 않는다.

### 3.2 직접 입찰

직접 입찰 승인 시 요청 금액이 새 현재가이며 해당 입찰자가 최고 입찰자다. 현재 최고 입찰자 자신의 직접 입찰은 `SELF_BID`로 거절한다. `SCHEDULED`, `ACTIVE`만 입찰 가능하며 `now >= endsAt`이면 `AUCTION_ENDED`다.

### 3.3 자동 입찰

자동 입찰은 사용자 최대가를 비공개로 저장한다. 두 최대가를 비교해 승자는 더 높은 최대가를 낸 사용자이며, 공개 현재가는 패자 최대가와 최소 단위로 결정한다.

```text
winnerMax > loserMax
→ currentPrice = min(winnerMax, loserMax + incrementFor(loserMax))
```

첫 자동 입찰만 있는 경우 현재가는 요청 최대가가 아니라 기존 현재가의 다음 최소 단위다. 같은 최대가에서는 먼저 Redis Lua Script에서 확정된 기존 최고 입찰자가 유지된다. 최고 입찰자 자신의 자동 최대가 상향은 `winnerMax`만 올리고 현재가는 바꾸지 않는다.

## 4. B. 결과와 연장 규칙

| 결과 코드 | 조건 |
|---|---|
| `ACCEPTED` | 가격·상태·소유자 규칙을 통과 |
| `BID_TOO_LOW` | 최소 다음 입찰가보다 작음 |
| `SELF_BID` | 현 최고 입찰자가 직접 입찰 |
| `AUCTION_ENDED` | `now >= endsAt` |
| `AUCTION_NOT_STARTED` | `now < startsAt` |
| `DUPLICATE_REQUEST` | 동일 `bidRequestId` 재처리 |

### 마감 임박 자동 연장

승인된 입찰의 처리 시각 `now`에서 남은 시간이 5분 미만이면 `endsAt = now + 5분`으로 설정한다. 남은 시간이 정확히 5분이면 연장하지 않는다. 거절된 입찰은 종료 시각을 절대 바꾸지 않는다.

```text
now = 13:11:30, endsAt = 13:15:00  → 승인 시 13:16:30으로 연장
now = 13:10:00, endsAt = 13:15:00  → 정확히 5분, 연장 없음
```

연장 결과는 승인 Event와 함께 `AuctionExtended` Event로 발행한다. 연장 판단·새 시각 계산은 Clock을 주입받은 순수 함수의 입력으로만 받으며 내부에서 `Instant.now()`를 호출하지 않는다.

## 5. I. 상태와 저장 경계

```text
HTTP bid request
  → bid-command(auctionId key)
  → Redis Lua: 가격·최고가·종료시각 원자 계산
  → PostgreSQL bid_ledger / outbox
  → bid-event: BidAccepted|BidRejected|AuctionExtended
```

- Redis는 활성 경매의 빠른 경쟁 상태다. 장애·유실 시 PostgreSQL 원장으로 재구성한다.
- PostgreSQL은 입찰 요청·결과의 원장이다.
- Kafka는 처리 순서를 보장하지 않고 같은 `auctionId` Partition 안의 명령 순서만 보장한다.
- 금액 계산 Domain은 Redis·Kafka·JDBC API를 참조하지 않는다.

## 6. T. 검증 계획

| 대상 | 정상 | 경계·오류 |
|---|---|---|
| 최소 단위 | 네 가격 구간의 다음 가격 | 99,999/100,000, 499,999/500,000 경계 |
| 직접 입찰 | 다음 최소가 이상 승인 | 낮은 금액·자기 입찰·시작 전·종료 후 거절 |
| 자동 입찰 | 높은 최대가 승리·공개가 계산 | 동점은 기존 승자, 최고자 상향은 가격 불변 |
| 연장 | 5분 미만 승인 시 정확히 `now + 5분` | 정확히 5분, 거절, 종료 후는 미연장 |
| 순수성 | 동일 입력 동일 결과 | 함수 내부 Clock·Redis·Kafka 호출 없음 |
| 동시성 | 같은 경매 명령 순서대로 단일 결과 | 서로 다른 경매는 독립 병렬 처리 |

## 7. 완료 조건

- [x] 직접·자동 입찰, 동점, 자기 입찰, 상태 거절 규칙을 확정했다.
- [x] 가격 구간과 최소 다음 입찰가를 정했다.
- [x] 5분 미만 승인 입찰의 종료 시각 연장 규칙을 명시했다.
- [x] 순수 Domain·Redis·PostgreSQL·Kafka의 책임을 분리했다.
- [x] 이후 구현·속성 테스트의 경계 사례를 정의했다.
