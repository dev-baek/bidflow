# [Issue #104] 마감 임박 입찰 자동 연장 보고서

- 작업 완료일: 2026-11-13
- Issue: [#104 마감 5분 미만 입찰 시 종료 시각 5분 자동 연장 구현](https://github.com/dev-baek/bidflow/issues/104)
- 사양: [issue-011-bid-domain.md](../specs/issue-011-bid-domain.md), [issue-015-auction-close.md](../specs/issue-015-auction-close.md)
- 브랜치: `feature/issue-104-auction-extension`

## 1. 구현 결과

- 순수 함수 `ListingAuctionRules.extendEndsAtAfterAcceptedBid`의 기준과 Redis Lua 구현을 일치시켰다.
- 승인 시 남은 시간이 5분 미만이면 **처리 시각 기준이 아니라 기존 `endsAt`에 정확히 5분을 추가**한다.
- 남은 시간이 정확히 5분이면 연장하지 않으며, 거절과 같은 `bidRequestId` 재실행은 종료 시각을 바꾸지 않는다.
- 연장된 종료 시각이 다시 5분 미만이 되는 새 승인 입찰은 또 5분을 더한다.
- Lua 결과의 `endsAt`은 기존 `JdbcBidLedgerRepository` Transaction에서 auction Row 갱신 및 `AuctionExtended` Outbox와 함께 저장된다. Scheduler는 매 Polling마다 PostgreSQL의 최신 `ends_at`을 읽으므로 별도 예약 갱신이 필요 없다.

## 2. 검증 증적

~~~sh
./backend/gradlew --no-daemon -p backend \
  :domain:test --tests com.bidflow.domain.listing.ListingAuctionRulesTest \
  :adapters:test --tests com.bidflow.adapters.persistence.RedisDirectBidProcessorIntegrationTest \
  --tests com.bidflow.adapters.persistence.RedisAutoBidProcessorIntegrationTest \
  --tests com.bidflow.adapters.persistence.JdbcBidLedgerRepositoryIntegrationTest
~~~

- 4분 남은 승인 직접·자동 입찰은 각각 기존 종료 시각에 5분을 더한다.
- 정확히 5분 남은 직접 입찰은 종료 시각을 바꾸지 않는다.
- 재연장 테스트는 첫 연장 뒤 다시 5분 미만이 된 새 승인 입찰이 추가 5분을 더함을 확인한다.
- PostgreSQL 통합 테스트는 승인 결과·경매 Row·`AuctionExtended` Outbox가 하나의 Transaction으로 저장되는 기존 경계를 확인한다.
