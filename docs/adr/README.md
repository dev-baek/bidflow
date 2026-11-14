# ADR 인덱스

BidFlow의 ADR은 기술 이름을 나열하는 문서가 아니라, **문제 → 대안 → 선택한 경계 → 실패 시 복구 → 전환 조건**을 기록한다. 현재 구현 또는 검증 가능한 설계만 사실로 적으며, AWS 실측 전 운영 결과를 단정하지 않는다.

| 결정 | 문제와 선택 | 핵심 계약 | 다시 검토할 조건 |
|---|---|---|---|
| [Kafka vs SQS FIFO](../specs/issue-029-kafka-sqs-decision-adr.md) | 경매별 순서, 독립 Consumer, 과거 재생 때문에 Kafka 선택 | `auctionId` Key, Partition 내 순서, Consumer Group별 Offset, at-least-once + 멱등성 | 재생·다중 Consumer 요구가 사라지고 Queue 단순성이 더 중요할 때 |
| [Redis 복구](../specs/issue-026-redis-recovery-adr.md) | 활성 경매의 원자 계산에는 Redis Lua, 최종 원장은 PostgreSQL | Redis 유실 시 원장 Snapshot으로 복구하고 요청을 재실행 | 활성 상태 계산을 별도 저장소로 옮겨야 할 실측 근거가 생길 때 |
| [OpenSearch 파생 데이터](../specs/issue-027-opensearch-derived-data-adr.md) | 검색 성능과 원본 거래 데이터를 분리 | PostgreSQL 원본 + 이벤트로 재색인, 장애가 등록/입찰을 막지 않음 | 검색 요구가 단순해져 PostgreSQL 조회로 충분할 때 |
| [EC2·ALB 런타임](../specs/issue-002-architecture-adr.md) | 장기 실행 Spring Boot API/Worker와 WebSocket | ALB Health Check, EC2 ASG, Nginx 미사용 | 경로 기반 다중 앱 또는 인스턴스 내부 전환 요구가 생길 때 |

## 공통 불변식

- PostgreSQL은 입찰·낙찰·Outbox의 최종 원장이다.
- Kafka는 전체 순서나 exactly-once를 보장하지 않는다. 같은 Partition의 순서와 멱등 Consumer를 사용한다.
- Redis와 OpenSearch는 복구 가능한 파생 데이터다.
- Redis Pub/Sub 유실은 Browser의 REST 상태 재조회로 보정한다.
- AWS 서비스는 실제 단기 검증·비용 기록 전까지 목표 아키텍처로만 설명한다.

## 증적 연결

- [Consumer 멱등성 보고서](../reports/issue-085-consumer-idempotency.md)
- [Redis 경매 복구 보고서](../reports/issue-086-redis-auction-recovery.md)
- [자동 연장 보고서](../reports/issue-104-auction-extension.md)
- [포트폴리오 증적 목록](../specs/issue-021-portfolio-docs.md)
