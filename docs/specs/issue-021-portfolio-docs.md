# [Issue #100] 포트폴리오 문서 구성과 증적 목록

- 상태: 제안됨
- 관련 Issue: [#100 포트폴리오 문서 구성과 증적 목록 확정](https://github.com/dev-baek/bidflow/issues/100)
- 후속 작업: #101 README·아키텍처·ADR 인덱스, #102 결과·회고

## 1. 포트폴리오 한 문장

BidFlow는 **경매 마감 직전의 동시 입찰을 Kafka 순서와 Redis Lua 원자 연산으로 처리하고, PostgreSQL 원장·Outbox·Consumer 멱등성으로 장애 뒤에도 결과를 복구하는 중고 경매 플랫폼**이다.

소개는 기능 나열보다 “왜 이 저장소·메시지 Broker·복구 경계를 선택했는가”와 그 선택을 어떤 테스트로 검증했는가를 우선한다.

## 2. 문서 산출물과 독자

| 산출물 | 독자 | 답해야 할 질문 | 작성 Issue |
|---|---|---|---|
| README | 채용 담당자·처음 보는 개발자 | 무엇을 만들었고 5분 안에 어떻게 실행하는가 | #101 |
| Architecture | 백엔드 면접관 | 요청·이벤트·데이터의 책임 경계는 무엇인가 | #101 |
| ADR index | 기술 면접관 | Kafka/Redis/OpenSearch를 왜 선택했는가 | #101 |
| Test evidence | 리뷰어 | 동시성·멱등성·자동 연장·장애를 어떻게 증명했는가 | #101/#102 |
| Load/failure report | 운영·SRE 관점 면접관 | 병목·Lag·복구 결과와 한계는 무엇인가 | #102 |
| Cost/runbook | 클라우드 면접관 | 로컬 우선 이유와 AWS 검증·삭제 기준은 무엇인가 | #87/#102 |

## 3. S. 사용자 가치 증적

| 사용자 결과 | 보여줄 화면/시나리오 | 코드·문서 증적 |
|---|---|---|
| 상품 등록 | 이미지 업로드 뒤 경매 ID 생성 | [등록 사양](issue-046-listing-registration.md), `ListingCreatePage` 테스트 |
| 검색 | 검색·필터·빈 결과·오류 상태 | [검색 사양](issue-010-search-api-ui.md), search state 테스트 |
| 동시 입찰 | `PENDING` 후 확정 결과, 현재가 갱신 | [입찰 명령 사양](issue-012-bid-command.md), Redis 동시성 테스트 |
| 자동 연장 | 5분 미만 승인 시 기존 종료 시각 +5분 | [자동 연장 보고서](../reports/issue-104-auction-extension.md) |
| 종료/낙찰 | Scheduler가 한 번만 `SOLD/UNSOLD` 확정 | [종료 사양](issue-015-auction-close.md), 종료 Repository 통합 테스트 |

E2E 화면 영상·screenshot은 #99가 실제 Browser 흐름을 통과한 뒤에만 README에 넣는다. 아직 없는 입찰/경매 상세 화면을 “완성 화면”으로 표현하지 않는다.

## 4. D/B. 기술 선택과 면접 답변 근거

| 기술 | 문제 | 선택 이유 | 증적 |
|---|---|---|---|
| PostgreSQL | 낙찰·원장·재시도 결과의 최종 사실 | Row lock, Transaction, 제약조건, Outbox를 하나의 내구성 경계로 사용 | schema/ledger/close 통합 테스트, [데이터 모델](issue-042-listing-auction-data-model.md) |
| Redis Lua | 한 경매의 현재가·최고가·요청 replay를 원자적으로 계산 | 여러 Redis 명령의 중간 상태 노출을 막고 짧은 수명 상태의 저지연 계산 담당 | [Redis ADR](issue-026-redis-recovery-adr.md), direct/auto Lua 테스트 |
| Kafka | 경매별 순서와 독립 Projection·재생 | `auctionId` Key의 Partition 순서, Consumer Group별 독립 Offset, 재생 가능 로그 | [Kafka/SQS ADR](issue-029-kafka-sqs-decision-adr.md), Topic 정책·Consumer 멱등 증적 |
| `consumer_event` | at-least-once 전달의 중복 효과 | `(consumer_name,event_id)` PK로 같은 Consumer 효과를 한 번으로 수렴 | [#85 보고서](../reports/issue-085-consumer-idempotency.md) |
| OpenSearch | 전문 검색·Filter/정렬 | PostgreSQL 원본과 분리된 재생 가능한 읽기 Projection, 장애가 등록/입찰을 막지 않음 | [OpenSearch ADR](issue-027-opensearch-derived-data-adr.md) |
| SeaweedFS/S3 계약 | 이미지 업로드와 애플리케이션 서버 분리 | presigned upload로 이미지 바이트가 API 서버를 통과하지 않게 함 | [등록 사양](issue-046-listing-registration.md) |

답변은 “기술을 써 봤다”가 아니라 **문제 → 대안 → 선택한 경계 → 실패 시 복구 → 테스트 증적** 순서로 구성한다.

## 5. I. 로컬·AWS·비용 표현 원칙

### 현재 사실

- Kafka, PostgreSQL, Redis, OpenSearch, SeaweedFS는 로컬 Docker 검증을 기준으로 한다.
- AWS 검증 환경은 상시 운영하지 않으며, 리소스 생성·삭제 Runbook과 비용 한도가 준비된 뒤에만 짧게 실행한다.
- k6와 장애 주입 도구는 준비됐지만, 활성 Fixture/API를 둔 실제 측정 결과는 아직 없다.

### 금지하는 표현

- “AWS에 배포 완료”, “MSK 운영 경험”, “P95 300ms 달성”처럼 아직 실행하지 않은 결과를 단정하지 않는다.
- 단일 Mac의 TPS를 일반적인 운영 처리량으로 일반화하지 않는다.
- Redis를 원장 또는 Kafka를 exactly-once 보장으로 설명하지 않는다.

### 허용하는 표현

- “AWS 이전을 전제로 로컬 Docker에서 계약·복구 경계를 검증하도록 설계했다.”
- “P95 300ms, Lag 60초 회복은 목표이며 #102에서 환경과 함께 실측을 기록한다.”

## 6. T. 증적 연결표

| 주장 | 최소 증적 | 상태 |
|---|---|---|
| 경매별 순서 | Topic Key/Partition 정책 + 같은 key 순서 테스트 | 구현됨 |
| 중복 소비 안전 | `consumer_event` DB 통합 테스트 + Listener replay 테스트 | 구현됨 |
| Redis 유실 복구 | `NOT_ACTIVE → Snapshot 복구 → 재실행` 테스트 | 구현됨 |
| 자동 연장 | 4:59/5:00/반복 연장 Lua·DB 테스트 | 구현됨 |
| 종료 단일성 | 다중 Scheduler `SKIP LOCKED` 통합 테스트 | 구현됨 |
| E2E Browser 흐름 | Playwright trace/screenshot + 원장 검증 | #99 대기 |
| 부하 P95·Lag 회복 | k6 JSON, SQL 불변식, consumer lag 결과 | 실제 실행 대기 |
| 장애 복구 실험 | Redis/OpenSearch 전후 상태, DLT Header | 실제 실행 대기 |
| AWS 비용 | 실행 시간·I/O·저장량·destroy 로그 | AWS 검증 대기 |

## 7. README 구성 순서

1. 문제와 한 문장 해결책
2. 핵심 사용자 흐름과 현재 지원 범위
3. 구조 다이어그램: Browser → API/Worker → PostgreSQL/Kafka/Redis/OpenSearch/S3
4. 중요한 설계 결정 4개: Outbox, Redis Lua, Kafka Consumer Group, 멱등·복구
5. 로컬 실행: prerequisites, `make local-up`, frontend/backend 실행, 정리 방법
6. 테스트 명령과 각 명령이 증명하는 것
7. 알려진 한계·다음 검증: E2E, 실측 부하·장애, AWS short-lived validation
8. ADR·상세 보고서 링크

## 8. 완료 조건

- [x] README·Architecture·ADR·테스트·비용·회고의 역할과 순서를 정했다.
- [x] 기술 선택마다 문제·선택 이유·복구·증적을 연결했다.
- [x] 구현됨과 실측/AWS 검증 대기 상태를 분리했다.
- [x] #101/#102가 사용할 증적 목록과 금지 표현을 정했다.
