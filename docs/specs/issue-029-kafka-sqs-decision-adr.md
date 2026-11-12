# [Issue #29] Kafka와 SQS 비교 ADR

- 상태: 승인됨
- 작성일: 2026-11-12
- 관련 Issue: [#29 Kafka와 SQS 비교 ADR 작성](https://github.com/dev-baek/bidflow/issues/29)
- 상위 사양: [EC2 이벤트 기반 아키텍처와 ADR](./issue-002-architecture-adr.md)

## 1. 결정

BidFlow의 입찰 명령과 도메인 이벤트 스트림은 Kafka를 사용한다. 개발·통합 테스트는 MacBook Docker Kafka에서 수행하고, AWS MSK 이전은 로컬 순서·재생·Consumer 장애 검증을 통과한 뒤 별도 비용 검토와 함께 진행한다.

SQS FIFO는 같은 경매를 하나의 Message Group으로 묶어 순서 있게 처리할 수 있으므로 기술적으로 가능한 대안이다. 그러나 이번 시스템은 하나의 확정 이벤트를 입찰 처리, 검색 Projection, 실시간 전파, 통계처럼 서로 독립적인 Consumer Group이 각자 소비하고 필요하면 과거 Offset부터 재생해야 한다. 이 요구에는 Topic·Partition·Consumer Group·Offset 모델을 제공하는 Kafka가 더 직접적이다.

## 2. 요구사항

| 요구사항 | 이유 |
|---|---|
| 경매별 순서 | 같은 `auctionId`의 자동입찰·연장·종료 순서가 바뀌면 결과가 달라질 수 있음 |
| 경매 간 병렬 처리 | 서로 다른 경매는 동시에 처리해 처리량을 확보해야 함 |
| 다중 독립 Consumer | 검색, 실시간 전파, 통계가 입찰 처리와 별도로 같은 Event를 소비해야 함 |
| 재생 | Projection 버그·OpenSearch 재색인·새 Consumer 추가 시 과거 Event를 다시 읽어야 함 |
| 장애 후 이어받기 | Consumer 재시작 후 Commit 전 Event를 다시 처리해야 함 |
| 중복 허용·멱등 처리 | 전달을 exactly-once로 가정하지 않고 `eventId`와 `bidRequestId`로 결과를 고정해야 함 |

## 3. 비교

| 기준 | Kafka | SQS FIFO |
|---|---|---|
| 경매별 순서 | `auctionId`를 Key로 같은 Partition에 기록 | `auctionId`를 Message Group ID로 지정 |
| 병렬성 | 여러 Partition을 여러 Consumer에 배정 | 서로 다른 Message Group을 병렬 처리 |
| 다중 Consumer | Consumer Group마다 독립 Offset으로 같은 Topic 소비 | Consumer마다 별도 Queue 또는 SNS Fan-out 설계 필요 |
| 과거 재생 | Consumer Group Offset을 되감아 재생 | 삭제된 메시지를 일반 Consumer가 다시 읽는 로그 모델이 아님 |
| 장애 처리 | Commit 전 Record를 다시 소비하고 Consumer 멱등 처리 | Visibility Timeout 뒤 메시지를 다시 받아 멱등 처리 |
| 운영 복잡도 | Topic, Partition, Retention, Lag 관측 필요 | Queue, Visibility Timeout, DLQ 관리가 비교적 단순 |
| 현재 개발 비용 | 로컬 Docker Kafka는 추가 AWS 비용 없음 | 로컬에서 AWS API를 모사하거나 AWS 계정 필요 |
| AWS 비용 특성 | MSK Serverless는 Cluster·Partition 시간과 I/O·저장 사용량 과금 | 요청 수와 데이터 전송량 중심의 관리형 Queue 과금 |

Kafka의 순서는 Topic 전체가 아니라 같은 Partition 안에서만 보장된다. 따라서 `auctionId` 외의 Key를 사용하거나 Key 없이 보내면 경매별 순서 계약이 깨진다. Consumer Group 안에서는 한 Partition을 한 Consumer만 읽도록 구성하고, Consumer 수가 Partition 수보다 많아도 순차 처리 수는 늘지 않는다.

SQS FIFO도 Message Group ID 안에서 순서를 유지하고 다른 Group은 병렬 처리할 수 있다. 다만 Message Group을 지정하지 않으면 전송이 실패하며, BidFlow의 Projection·통계처럼 서로 다른 소비자가 같은 과거 Event를 독립적으로 재생해야 하는 요구에는 Queue Fan-out과 별도 보관·재처리 설계가 추가된다.

## 4. Kafka 계약

```text
Topic: bid-command
Key: auctionId
Value: bidRequestId, auctionId, userId, bid amount, schemaVersion
Consumer Group: bid-worker

Topic: domain-event
Key: auctionId 또는 productId
Value: eventId, eventType, aggregateId, occurredAt, schemaVersion
Consumer Group: search-projection
Consumer Group: realtime-projection
Consumer Group: analytics-projection
```

Key는 업무 Aggregate를 기준으로 선택한다. 입찰·연장·종료의 순서가 필요한 메시지는 `auctionId`, 상품 검색 문서는 `productId`를 Key로 사용한다. 서로 다른 Key 사이의 전역 순서는 요구하지 않는다.

Producer는 PostgreSQL Transactional Outbox가 발행한다. Consumer는 외부 상태 변경과 처리 완료 기록이 성공한 후에만 Offset을 Commit한다. Publisher와 Consumer의 재시도 때문에 중복 전달은 발생할 수 있으므로, Consumer는 `eventId` 또는 `bidRequestId` 처리 기록으로 멱등성을 보장한다.

## 5. 로컬 우선 검증

로컬 Docker Kafka에서 다음을 증명한 뒤에만 MSK 이전을 검토한다.

| 시나리오 | 기대 결과 |
|---|---|
| 같은 `auctionId` 명령 3개 발행 | 한 Partition에서 발행 순서대로 Bid Worker가 처리 |
| 서로 다른 `auctionId` 발행 | 다른 Partition·Consumer에서 병렬 처리 가능 |
| Consumer 중단 후 재시작 | Commit 전 Event를 다시 처리하고 원장 결과는 한 번만 반영 |
| 새 Projection Consumer Group 추가 | 기존 Topic의 보존된 Event부터 독립 처리 |
| OpenSearch Projection 오류 수정 | Offset 재설정 또는 새 Group으로 필요한 범위 재생 |
| 동일 Event 재발행 | `eventId` 기준으로 파생 상태가 중복 변경되지 않음 |

이 검증은 Topic 생성·Partition 정책을 정의하는 후속 #53, Event Contract #8, Kafka Adapter 통합 테스트에서 실제로 구현한다.

## 6. SQS FIFO로 전환할 조건

다음 조건이 모두 충족되면 SQS FIFO를 다시 검토한다.

1. 같은 메시지를 여러 독립 Consumer가 재생할 요구가 사라지거나, SNS Fan-out과 별도 재처리 저장소를 수용한다.
2. Consumer Offset 기반 재생보다 Queue 기반 작업 처리의 단순성이 더 중요하다.
3. Event Stream 관측, Partition 운영, 장기 보존의 포트폴리오 목표가 제외된다.
4. AWS 비용 실측에서 MSK 운영 비용이 검증 예산을 지속적으로 초과한다.

전환해도 PostgreSQL Outbox, `bidRequestId`·`eventId` 멱등성, 경매별 Key/Group ID, Redis·OpenSearch 복구 계약은 유지한다. 메시지 Broker만 바꾼다고 정확히 한 번 처리나 전역 순서를 주장하지 않는다.

## 7. 비용과 AWS 이전

현재 단계에서는 AWS 비용이 발생하지 않는 로컬 Docker Kafka만 사용한다. MSK Serverless는 Cluster와 Partition의 시간 비용뿐 아니라 Producer·Consumer I/O와 저장 사용량에 따라 과금되므로, 실제 검증 전에는 생성하지 않는다. AWS 전환 시에는 실행 시간, Partition 수, 입출력량, 저장량을 측정하고 예산 한도와 함께 기록한다.

SQS FIFO는 관리 부담이 낮은 대안이지만, 이번 프로젝트의 순서 보장·독립 Consumer Group·이벤트 재생을 한 서비스 안에서 검증하는 목표에는 Kafka가 더 맞는다. 비용 우려는 Broker 교체가 아니라 로컬 검증 완료 전 AWS 리소스를 만들지 않는 방식으로 먼저 해결한다.

## 8. 근거

- [Apache Kafka Introduction and Guarantees](https://kafka.apache.org/0100/getting-started/introduction/): Partition 내 순서와 Consumer Group의 Partition 배정 모델
- [Amazon SQS FIFO queue delivery logic](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/FIFO-queues-understanding-logic.html): Message Group 단위 순서와 병렬 처리 모델
- [Amazon MSK pricing](https://aws.amazon.com/msk/pricing/): MSK Serverless의 Cluster·Partition 시간, I/O, 저장 과금 항목

## 9. 완료 조건

- [x] Kafka와 SQS FIFO의 순서 보장 단위를 비교했다.
- [x] 다중 Consumer와 과거 재생 요구가 Kafka 선택으로 이어지는 이유를 기록했다.
- [x] `auctionId` Key·Partition·Consumer Group 계약을 정의했다.
- [x] At-least-once와 멱등 Consumer 원칙을 명시했다.
- [x] SQS FIFO 전환 조건과 유지해야 할 도메인 계약을 정의했다.
- [x] 로컬 우선 검증과 AWS 비용 판단 기준을 기록했다.
