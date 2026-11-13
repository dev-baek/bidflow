# [Issue #85] Consumer eventId 멱등 처리와 실패 격리 보고서

- 작업 완료일: 2026-11-13
- Issue: [#85 Consumer eventId 멱등 처리와 실패 격리 구현](https://github.com/dev-baek/bidflow/issues/85)
- 사양: [issue-016-failure-recovery.md](../specs/issue-016-failure-recovery.md)
- 브랜치: `feature/issue-85-consumer-idempotency`

## 1. 구현 결과

- PostgreSQL `consumer_event`에 `(consumer_name, event_id)` PK를 두고, `INSERT ... ON CONFLICT DO NOTHING`으로 같은 Consumer의 중복 이벤트를 한 번으로 수렴시켰다.
- `bid-settlement`, `realtime-projection`, `search-projection`, `auction-finalization` Consumer가 처리 기록을 남긴 뒤에만 효과를 실행한다.
- `TransactionTemplate`으로 처리 기록과 PostgreSQL 효과가 같은 Transaction 경계를 사용한다. Redis·WebSocket·OpenSearch는 원래부터 재실행 가능한 파생 효과이며, 처리 기록이 없어도 안전해야 한다.
- Kafka 오류는 `DefaultErrorHandler`로 분리했다. `IllegalArgumentException` 계약 오류는 재시도 없이 `<원본 topic>.DLT`로 보내고, 그 밖의 일시 오류는 1초·2초·4초, 총 3회 재시도 후 DLT로 보낸다.
- DLT에는 원본 payload를 변경하지 않고 원본 topic/partition/offset, 실패 분류, 예외 정보, UTC 실패 시각 Header를 추가한다.
- 로컬 Topic provisioning에 `bid-command.DLT`, `bid-event.DLT`, `listing-event.DLT`를 포함했다.

## 2. 검증 증적

~~~sh
./backend/gradlew --no-daemon -p backend \
  :adapters:test --tests com.bidflow.adapters.persistence.JdbcConsumerEventRepositoryIntegrationTest \
  :runtime:test --tests com.bidflow.runtime.DirectBidCommandKafkaListenerTest \
  --tests com.bidflow.runtime.AuctionEndedKafkaListenerTest \
  --tests com.bidflow.runtime.BidRealtimeKafkaListenerTest \
  --tests com.bidflow.runtime.SearchIndexingKafkaListenerTest \
  --tests com.bidflow.runtime.KafkaFailureCategoryTest
sh tests/scripts/provision-kafka-topics.test.sh
~~~

- `JdbcConsumerEventRepositoryIntegrationTest`: 같은 eventId를 같은 Consumer가 두 번 처리하면 두 번째 insert는 실패하고, 서로 다른 Consumer는 각각 처리 기록을 남긴다.
- Listener Test: 같은 Kafka record를 두 번 전달해도 정산/Redis 정리 효과는 한 번만 실행된다.
- Failure Header Test: 계약 오류가 `CONTRACT_INVALID`와 원본 Kafka 위치를 보존한다.
- Shell Test: 정상·DLT Topic 모두 Partition 3, Replication Factor 1, 7일 보존 정책을 검증한다.

## 3. 운영 경계

- DLT publish 자체가 실패하면 Recoverer가 예외를 전파하므로 원본 offset은 진행하지 않는다.
- DLT Replay는 `eventId`를 바꾸지 않는다. 이미 성공한 Consumer는 같은 eventId를 다시 효과로 만들지 않는다.
- `NOT_ACTIVE` Redis 상태 재구성과 `BUSINESS_INVARIANT`의 구체적 원인 분류는 후속 #86의 복구 흐름에서 다룬다.
