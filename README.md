# BidFlow

> 경매 마감 직전의 동시 입찰을 순서 있게 처리하고, 장애 뒤에도 원장으로 복구하는 중고 경매 플랫폼

BidFlow는 단순한 CRUD 경매 서비스가 아니라 **동시 입찰의 정합성**을 다루는 포트폴리오 프로젝트다. 같은 경매의 입찰 명령은 Kafka에서 순서 있게 소비하고, 활성 경매의 가격 계산은 Redis Lua Script로 원자적으로 수행한다. PostgreSQL은 입찰 원장과 Outbox를 보관하는 최종 사실의 원천이며, Consumer는 멱등 처리로 at-least-once 전달의 중복 효과를 제거한다.

## 현재 구현 범위

| 영역 | 현재 상태 | 설명 |
|---|---|---|
| 상품 등록 | 구현됨 | SeaweedFS(S3 호환) presigned upload와 상품·경매 생성 API |
| 상품 검색 | 구현됨 | 검색 상태 모델과 OpenSearch 파생 인덱스 계약 |
| 입찰 엔진 | 구현됨 | Redis Lua 직접/자동 입찰, 요청 재실행, Redis 복구 |
| 자동 연장·종료 | 구현됨 | 마감 5분 미만 입찰 시 종료 시각 +5분, 중복 종료 방지 |
| Kafka·Outbox | 구현됨 | 경매별 Key, Consumer 멱등성, DLT 계약 |
| Browser E2E | 진행 전 | 입찰·경매 상세 화면과 테스트 전용 인증/Clock이 선행되어야 함 |
| k6·장애 실측 | 진행 전 | 실행 스크립트는 준비됐고 Fixture/API를 둔 측정이 남아 있음 |
| AWS 배포 | 진행 전 | 로컬 Docker 검증 뒤 단기 실행 환경에서만 검증 예정 |

`구현됨`은 코드와 테스트가 있는 범위다. 성능 수치나 AWS 운영 경험은 실제 실행 결과가 생기기 전까지 주장하지 않는다.

## 핵심 흐름

```text
판매자: 이미지 직접 업로드 → 상품/경매 등록 → Outbox → Kafka → 검색 Projection

구매자: 입찰 접수(202) → PostgreSQL 요청/Outbox → Kafka(auctionId Key)
        → Bid Worker → Redis Lua 가격 계산 → 원장/결과 Outbox
        → Kafka → 검색·실시간 Projection
```

입찰 API는 최종 낙찰 결과가 아니라 **접수 결과**를 반환한다. 최종 처리 결과는 이벤트와 상태 조회로 확인하는 비동기 계약이다.

## 왜 이 기술을 사용했나

| 기술 | 담당 문제 | 선택 근거 |
|---|---|---|
| PostgreSQL | 입찰 원장과 낙찰의 최종 사실 | Transaction, 제약조건, 잠금, Outbox를 하나의 내구성 경계로 유지 |
| Kafka | 경매별 순서·독립 Consumer·이벤트 재생 | `auctionId` Key의 Partition 순서와 Consumer Group별 Offset을 사용 |
| Redis Lua | 활성 경매의 원자적 가격 계산 | 여러 Key 변경 중간 상태를 노출하지 않고 요청 재시도 결과를 고정 |
| OpenSearch | 전문 검색과 Filter/정렬 | PostgreSQL 원본에서 재생 가능한 읽기 Projection으로 분리 |
| SeaweedFS/S3 | 상품 이미지 전송 | Browser가 presigned URL로 직접 업로드하여 API 서버 부하를 분리 |

Kafka는 전역 순서나 exactly-once를 보장한다고 주장하지 않는다. 같은 Partition의 순서와 at-least-once 전달을 전제로, `bidRequestId`·`eventId`·`consumer_event`로 결과를 멱등하게 만든다.

## 로컬 실행

### 필요 환경

- Docker Desktop
- Java 21
- Node.js 24

로컬 구성은 PostgreSQL, Kafka, Redis, SeaweedFS를 Docker로 실행한다. OpenSearch는 메모리 사용량 때문에 별도 profile로 분리했다.

```bash
# 기본 인프라: PostgreSQL, Kafka, Redis, SeaweedFS 및 Kafka Topic
make local-up

# OpenSearch까지 포함
make local-up-search
```

새 터미널에서 백엔드와 프론트엔드를 실행한다.

```bash
# Spring Boot API
./backend/gradlew -p backend :runtime:bootRun

# Vite 개발 서버
cd apps/web
npm install
npm run dev
```

로컬 서비스를 멈출 때는 다음 명령을 사용한다. `local-reset`은 데이터 볼륨을 초기화하므로 테스트 데이터가 필요 없을 때만 실행한다.

```bash
make local-down
```

환경변수 기본값은 [.env.example](.env.example)에 있으며, 이 값은 로컬 Docker 전용이다. AWS Secret이나 운영 자격 증명으로 재사용하지 않는다.

## 테스트와 검증

```bash
# Java 도메인·어댑터·통합 테스트와 모듈 의존성 규칙
./backend/gradlew -p backend check

# React 상태 전이·컴포넌트 테스트 (Node 24 필요)
cd apps/web && npm run test:run

# 프론트엔드 production build
cd apps/web && npm run build

# k6 실행 시나리오 준비 상태 확인/실행
make load-focused
make load-distributed
```

k6는 실제 입찰 Fixture와 API가 준비된 뒤에 실행 결과(JSON, Consumer Lag, SQL 불변식)를 별도 보고서로 기록한다. 측정하지 않은 P95나 TPS를 README에 적지 않는다.

## 문서 지도

- [Architecture](docs/architecture.md): S/D/B/I/T 책임 경계와 요청·복구 흐름
- [ADR 인덱스](docs/adr/README.md): 기술 선택, 대안, 전환 조건
- [제품 범위](docs/specs/issue-001-project-scope.md): 사용자·MVP·성공 기준
- [포트폴리오 증적 목록](docs/specs/issue-021-portfolio-docs.md): 구현/실측/AWS 검증 상태
- [부하 테스트 보고서](docs/reports/issue-095-k6-bid-load.md): k6 시나리오와 측정 전제
- [장애 실험 보고서](docs/reports/issue-096-failure-experiment.md): Redis/OpenSearch 장애 주입 절차

## 로드맵과 한계

다음 구현 우선순위는 입찰·경매 상세 Browser 화면, 테스트 전용 인증·Clock, Playwright E2E, 실제 k6·장애 실험이다. AWS는 상시 운영하지 않는다. 로컬 검증을 마친 뒤 Terraform으로 짧게 생성하고, 결과·비용을 기록한 뒤 삭제하는 방식으로 검증한다.

상세 설계와 증적 상태는 [포트폴리오 문서 구성과 증적 목록](docs/specs/issue-021-portfolio-docs.md)을 기준으로 한다.
