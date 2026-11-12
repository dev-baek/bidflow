# [Issue #71] Redis 입찰 엔진·PostgreSQL 원장 사양

- 상태: 제안됨
- 관련 Issue: [#71 Redis Key·Lua·PostgreSQL 원장 사양 작성](https://github.com/dev-baek/bidflow/issues/71)
- 후속 작업: #72 Redis Key Repository, #73 직접 입찰 Lua, #74 원장·bid-event, #75 자동 입찰 Lua, #76 동시성 검증

## 1. 목적과 원칙

Redis는 활성 경매의 경쟁 상태를 원자적으로 갱신하는 고속 파생 저장소다. PostgreSQL `auction`, `bid_request`, `bid_ledger`가 내구성 원장이며 Redis 유실은 원장으로 복구한다. Domain 가격 함수는 Redis API를 참조하지 않고 Lua는 그 계산 결과·규칙을 단일 Redis 실행으로 적용한다.

## 2. S. 사용자 결과

직접·자동 입찰 요청은 `PENDING` 뒤 `ACCEPTED` 또는 `REJECTED`가 된다. 승인 시 최신 현재가·최고 입찰자 본인 여부·연장된 종료 시각을 WebSocket과 조회 API로 전달한다. Browser는 Redis 값을 직접 읽지 않는다.

## 3. D. Redis Key·TTL

| Key | 타입 | 값 | TTL |
|---|---|---|---|
| `auction:{auctionId}:state` | Hash | status, currentPrice, winnerId, winnerMax, startsAt, endsAt, version | `endsAt + 24시간` |
| `auction:{auctionId}:auto` | Sorted Set | member=bidderId, score=maximum | `endsAt + 24시간` |
| `auction:{auctionId}:processed` | Hash | field=`bidRequestId`, value=최초 Lua 결과 | `endsAt + 24시간` |

- Sorted Set score는 최대가 정수다. 같은 score의 승자 우선순위는 ZSET lexicographic 순서가 아니라 state의 기존 `winnerId`로 결정한다.
- `processed`는 단순 Set 대신 최초 결과를 함께 저장하는 Hash다. 재소비는 가격을 다시 계산하지 않고 이 결과를 반환한다.
- TTL은 Script가 종료 시각을 연장하면 `endsAt + 24시간`으로 함께 갱신한다.
- 종료 후 24시간은 장애 복구·재처리 확인 여유다. 장기 원장은 PostgreSQL에만 남긴다.

## 4. B. Lua 원자 경계

같은 `auctionId` 명령은 하나의 Lua Script가 다음을 모두 수행한다.

1. `processed`에 `bidRequestId`가 있으면 고정된 기존 결과를 반환한다.
2. state의 status·startsAt·endsAt을 확인한다.
3. 최소 다음 가격·직접/자동 최대가·동점 우선순위를 계산한다.
4. currentPrice, winnerId, winnerMax, version과 auto ZSET을 갱신한다.
5. 승인 시 남은 시간이 5분 미만이면 `endsAt = now + 5분`으로 연장하고 모든 TTL을 갱신한다.
6. `processed`에 요청 ID를 기록하고 안정적인 결과 코드·새 상태를 반환한다.

Script 외부에서 `GET → 계산 → SET`을 나누지 않는다. 다중 Worker가 같은 경매를 처리해도 Redis 단일 Script 실행 순서로 상태가 직렬화된다.

| 반환 코드 | Redis 상태 변경 |
|---|---|
| `ACCEPTED` | 가격·승자·version·processed, 필요 시 endsAt·TTL |
| `BID_TOO_LOW`, `SELF_BID`, `AUCTION_NOT_STARTED`, `AUCTION_ENDED` | processed와 결과 기록만, 가격·종료 시각 불변 |
| `DUPLICATE_REQUEST` | 기존 처리 결과 반환, 상태 불변 |

## 5. I. PostgreSQL 원장·복구

```text
bid-command Worker
 → Redis Lua 결과
 → PostgreSQL Transaction: bid_request 상태 + bid_ledger + bid-event Outbox
 → Kafka bid-event
```

- Redis 승인 결과를 받은 뒤 PostgreSQL Transaction이 실패하면 Worker는 Offset을 Commit하지 않는다. 재소비는 `bidRequestId`와 Redis `processed`로 같은 결과를 얻는다.
- Redis가 비어 있으면 PostgreSQL의 Auction·승인 bid_ledger·자동 최대가를 읽어 state/ZSET을 재구성한다.
- Redis 장애 중에는 Worker가 실패하고 명령은 Kafka에 남는다. 등록·검색·원장 조회는 Redis 장애로 롤백하지 않는다.
- PostgreSQL 원장이 Redis보다 항상 최종 진실이며, 검색·WebSocket Projection은 `bid-event`에서 갱신한다.

## 6. T. 검증 계획

| 대상 | 정상 | 오류·경계 |
|---|---|---|
| Key | 상태·ZSET·processed 생성과 TTL | 연장 시 TTL 재설정, 종료 뒤 만료 |
| 직접 Lua | 최소가 이상 승인·version 증가 | 낮은가·자기·시작 전·종료 후 거절 |
| 자동 Lua | 높은 최대가 승리·동점 기존 승자 | 최대가 초과 공개 금액 금지 |
| 연장 | 5분 미만 승인 시 `now + 5분` | 정확히 5분·거절은 미연장 |
| 동시성 | 같은 경매 요청이 직렬 결과 | 1,000 동시 요청에도 가격 감소·중복 원장 없음 |
| 복구 | PostgreSQL 원장에서 Redis 재구성 | Redis flush 뒤 같은 결과·후속 입찰 가능 |

## 7. 완료 조건

- [x] Redis Key·자료구조·TTL·원장 책임을 정의했다.
- [x] Lua 원자 경계·중복·연장 규칙을 정의했다.
- [x] PostgreSQL Transaction·Kafka Offset·Redis 복구 경계를 정의했다.
- [x] 직접·자동·동시성·장애 검증 기준을 정의했다.
