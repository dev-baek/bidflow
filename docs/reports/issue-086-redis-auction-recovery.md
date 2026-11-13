# [Issue #86] Redis 활성 경매 상태 재구성 보고서

- 작업 완료일: 2026-11-13
- Issue: [#86 Redis 활성 경매 상태 재구성 구현](https://github.com/dev-baek/bidflow/issues/86)
- 사양: [issue-016-failure-recovery.md](../specs/issue-016-failure-recovery.md)
- 브랜치: `feature/issue-86-redis-auction-recovery`

## 1. 구현 결과

- `auto_bid_maximum` PostgreSQL 테이블을 추가해 자동입찰 최대가를 Redis Sorted Set 밖에도 영속했다. 같은 사용자의 낮은 최대가 재등록은 기존 높은 값보다 작아지지 않는다.
- `NOT_ACTIVE`를 받은 Bid Worker는 해당 `auctionId` 하나의 PostgreSQL Snapshot과 자동입찰 설정만 읽어 Redis Hash·ZSET을 복구하고, 같은 명령을 한 번 재실행한다.
- 복구 대상이 `ENDED`/`CANCELLED`이거나 현재 시각에 이미 종료된 경매면 Redis Key를 지우고 `AUCTION_ENDED` 결과로 수렴한다. 종료 상태를 활성 경매로 되살리지 않는다.
- Redis Snapshot의 TTL은 `endsAt + 24시간`으로 설정해 동일 `bidRequestId`의 짧은 재처리 결과 보존 정책과 맞췄다.
- `AUTO_MAX` 승인 원장 저장과 자동입찰 최대가 저장은 Consumer Transaction 안에서 함께 수행된다.

## 2. 검증 증적

~~~sh
./backend/gradlew --no-daemon -p backend \
  :application:test --tests com.bidflow.application.bid.AuctionStateRecoveryServiceTest \
  :adapters:test --tests com.bidflow.adapters.persistence.JdbcAuctionRecoverySnapshotRepositoryIntegrationTest \
  :runtime:test --tests com.bidflow.runtime.DirectBidCommandKafkaListenerTest
~~~

- Application Test: 활성 경매는 요청된 단일 `auctionId`의 state·자동입찰 최대가만 복구하고, 종료 경매는 Key 제거로 끝난다.
- Adapter Test: PostgreSQL Snapshot이 경매 현재가·최고 입찰자·최고 자동입찰 최대가를 정확히 읽으며 낮은 최대가 재저장이 기존 값을 낮추지 않음을 확인했다.
- Runtime Test: 첫 Lua 결과가 `NOT_ACTIVE`면 복구 후 같은 명령을 한 번 다시 실행하고, 원장은 한 번만 저장한다.

## 3. 운영 경계

- 복구 Snapshot을 찾지 못하거나 재구축 뒤에도 `NOT_ACTIVE`면 예외를 전파한다. #85의 Kafka 재시도·DLT 정책이 offset을 커밋하지 않고 처리한다.
- 전체 Redis Flush나 전체 경매 배치 복구는 수행하지 않는다. 전면 유실의 일괄 복구는 별도 운영 작업으로 둔다.
