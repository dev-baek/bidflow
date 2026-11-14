# BidFlow Architecture

- 상태: 현재 구현과 목표 AWS 구조를 구분해 설명하는 Architecture 인덱스
- 상위 문서: [프로젝트 범위](specs/issue-001-project-scope.md), [포트폴리오 증적 목록](specs/issue-021-portfolio-docs.md)

## 구조 개요

```text
Browser
  │  REST / WebSocket
  ▼
Spring Boot API ───────────────┐
  │                             │
  ▼                             ▼
PostgreSQL (원장·Outbox)      Redis (활성 경매 계산·Pub/Sub)
  │
  ▼
Kafka (경매별 명령 순서·도메인 이벤트)
  ├── Bid Worker → PostgreSQL / Redis
  ├── Search Projection → OpenSearch
  └── Realtime Projection → Redis Pub/Sub → Browser

Browser ── presigned URL ──▶ SeaweedFS / S3 (상품 이미지)
```

## S. 화면과 사용자 흐름

| 흐름 | 동기 응답 | 비동기 결과 |
|---|---|---|
| 상품 등록 | 입력 검증과 등록 ID | `ListingPublished` 뒤 검색 Projection |
| 상품 검색 | 검색 결과·빈 결과·오류 상태 | 색인 지연은 최종적 일관성으로 허용 |
| 입찰 접수 | `202 Accepted`, `bidRequestId` | 승인/거절·현재가·자동 연장 결과 |
| 경매 종료 | 별도 사용자 요청 없음 | Scheduler가 낙찰/유찰을 한 번 확정 |

화면 상태는 React/TypeScript의 순수 State/Reducer로 모델링하고, 상태 전이 테스트를 작성한다. WebSocket이 끊기면 REST 상태 조회로 화면을 보정한다.

## D. 데이터와 정합성 경계

| 저장소 | 책임 | 복구 방법 |
|---|---|---|
| PostgreSQL | 상품·경매·입찰 원장·낙찰·Outbox·Consumer 처리 기록 | 최종 원본. Flyway와 Transaction으로 관리 |
| Redis | 활성 경매 가격·자동 입찰·짧은 TTL·실시간 Pub/Sub | PostgreSQL 확정 원장으로 활성 상태 재구성 |
| Kafka | 입찰 명령·확정 도메인 이벤트 | Retention 범위에서 Consumer Group Offset으로 재생 |
| OpenSearch | 상품 검색 Projection | PostgreSQL Snapshot과 이벤트로 전체 재색인 |
| SeaweedFS/S3 | 상품 이미지 객체 | Object Key를 PostgreSQL에 참조; API 서버는 바이트를 중계하지 않음 |

PostgreSQL만 최종 원장이다. Redis와 OpenSearch는 파생 데이터이며 유실 또는 장애가 핵심 입찰 결과를 변경해서는 안 된다.

### 입찰 정합성

1. API가 `bidRequestId`와 입찰 요청을 PostgreSQL Transaction으로 저장하고 Outbox Row를 함께 만든다.
2. Outbox Publisher가 `auctionId`를 Kafka Key로 `bid-command` Topic에 발행한다.
3. Bid Worker는 같은 `auctionId`가 같은 Partition에서 소비되는 계약에 의존한다.
4. Redis Lua Script가 현재가·최고 입찰자·자동 입찰 상태·요청 replay를 원자적으로 계산한다.
5. 결과 입찰 원장, 경매 상태, 결과 Outbox를 하나의 PostgreSQL Transaction으로 저장한다.
6. Consumer는 `(consumer_name, event_id)`로 처리 완료를 기록하고, 중복 수신해도 결과를 한 번으로 수렴시킨다.

Kafka의 순서는 같은 Partition 안에서만 보장된다. 이 설계는 exactly-once 전달이 아니라 at-least-once 전달과 멱등 처리로 최종 결과를 지킨다.

## B. 백엔드 책임 분리

```text
domain          순수 입찰·자동 연장·낙찰 규칙
application     Use case와 Port
event-contract  이벤트 Schema
adapters        JPA, Kafka, Redis, OpenSearch, S3 구현
runtime         Spring Boot Controller, Listener, Scheduler 조립
```

시간은 `Clock` 또는 `Instant`로, UUID·외부 설정은 입력이나 Port로 주입한다. Controller, Kafka Listener, Scheduler에는 업무 규칙을 두지 않으며 Domain 함수를 호출하는 Imperative Shell로 둔다.

### 자동 연장과 종료

- 승인된 입찰 시점이 종료 5분 미만이면 **현재 종료 시각에 5분을 더한다.**
- 정확히 5분 남은 경우는 연장하지 않는다.
- 종료 Scheduler는 `FOR UPDATE SKIP LOCKED`로 여러 실행자 중 하나만 진행 중 경매를 종료하게 한다.
- 이미 종료된 경매는 추가 낙찰 결과를 만들지 않는다.

## I. 실행 환경

### 현재: 로컬 Docker

개발과 통합 검증은 Docker PostgreSQL, Kafka, Redis, SeaweedFS, 선택적 OpenSearch에서 실행한다. 서비스 시작과 Topic/Index 준비는 `Makefile` 명령으로 표준화한다.

### 목표: 단기 AWS 검증

AWS 배포는 아직 완료된 사실이 아니다. 검증 시 다음 구조를 사용하도록 설계했다.

```text
CloudFront + Private S3 ── 정적 Vite Asset
Public ALB ── HTTPS / WSS / Health Check
Private EC2 ASG ── Spring Boot API·Worker·Scheduler
RDS / MSK / ElastiCache / OpenSearch / S3 ── 관리형 데이터 서비스
```

검증 환경은 월 10만 원 예산에서 짧게 생성하고 삭제한다. 비용, 실행 시간, 생성·삭제 로그가 없으면 “AWS 운영 경험” 또는 성능 결과로 표현하지 않는다. 상세 설계는 [EC2 이벤트 기반 아키텍처와 ADR](specs/issue-002-architecture-adr.md)를 따른다.

## T. 검증 전략

| 계층 | 증명할 것 | 현재 증적 |
|---|---|---|
| Domain unit | 입찰가·자동 입찰·5분 연장 경계 | 순수 함수 테스트 |
| Adapter integration | Redis Lua·PostgreSQL·Kafka 처리 계약 | Testcontainers 기반 테스트 |
| Consumer recovery | 중복 Event·Redis 유실 뒤 결과 수렴 | `consumer_event`, Redis recovery 테스트 |
| Load/failure | P95, Lag, 원장 불변식, 장애 전후 복구 | k6·장애 주입 스크립트 준비, 실측 대기 |
| Browser E2E | 등록→검색→동시 입찰→연장→종료 | 화면·테스트 인증/Clock 선행 후 진행 |

## 관련 결정 기록

기술별 대안과 전환 조건은 [ADR 인덱스](adr/README.md)에서 확인한다. Architecture는 책임과 데이터 흐름을 설명하고, ADR은 “왜 이 선택을 했는가”를 설명한다.
