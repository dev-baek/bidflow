# [Issue #94] 부하·장애 실험 계획과 성공 기준

- 상태: 제안됨
- 관련 Issue: [#94 부하·장애 실험 계획과 성공 기준 작성](https://github.com/dev-baek/bidflow/issues/94)
- 후속 구현: #95 k6 동시 입찰, #96 Consumer·Redis·OpenSearch 장애 실험, #97 Kafka 선택 검증, #102 결과·회고

## 1. 목적과 범위

이 실험은 Apple Silicon MacBook의 로컬 Docker 환경에서 “몇 TPS를 냈는가”를 과장하기 위한 것이 아니다. 다음 운영 성질을 재현 가능하게 증명한다.

1. 같은 경매의 동시 입찰이 가격·낙찰자·원장을 모순 없이 수렴한다.
2. 비동기 입찰 접수와 최종 WebSocket/원장 결과의 지연을 관측한다.
3. Kafka Consumer가 부하 종료 뒤 Lag를 회복한다.
4. Redis·OpenSearch·Consumer 장애가 PostgreSQL 원장과 다른 독립 기능을 침범하지 않는다.

AWS는 이 단계의 실행 대상이 아니다. 로컬 기준을 통과한 뒤 검증 환경에서 같은 스크립트와 임계값을 재측정한다. 단일 Mac의 절대 TPS는 환경 의존적이므로 결과 보고서에 CPU·메모리·Docker 자원 설정을 함께 남긴다.

## 2. S. 사용자 관점 시나리오

| 시나리오 | 사용자가 보는 결과 | 허용되는 일시 상태 |
|---|---|---|
| 동시 직접 입찰 | 접수는 `202 PENDING`, 최종가는 하나의 순서로 확정 | WebSocket 지연, REST Snapshot 재조회 |
| 자동 입찰 경쟁 | 공개 현재가만 노출, 최대가 비공개 | 최종 이벤트 처리 대기 |
| Redis 중단 | 새 입찰은 처리 대기, 기존 경매 조회·검색은 계속 가능 | Redis 재시작 뒤 단일 경매 복구 |
| OpenSearch 중단 | 검색은 명시적 오류, 등록·입찰은 계속 가능 | 색인 Consumer Lag |
| Consumer 중단 | API 접수는 유지, 실시간 결과만 늦음 | 재시작 뒤 이벤트 재소비 |

부하 중 Browser는 최종 판단을 WebSocket만으로 하지 않는다. `bid_request`와 경매 REST Snapshot이 확정 상태의 기준이다.

## 3. D. 데이터와 정합성 기준

### 3.1 고정 Fixture

- 활성 경매 1개: 시작가는 10,000원, 종료까지 10분 이상 남김
- 경쟁 입찰자 20명: 각 요청의 `bidRequestId`, `Idempotency-Key`, `correlationId`는 모두 기록
- 자동 입찰 경매 1개: 서로 다른 최대가 5개
- 검색 색인 대상 상품 100개: 카테고리·가격·상태·마감 시각을 분산

Fixture는 실험마다 새 UUID 접두사 또는 테스트 전용 데이터베이스로 분리한다. 기존 개발 데이터 삭제, `FLUSHALL`, 광범위한 Docker volume 삭제는 금지한다.

### 3.2 실험 후 SQL 검증

| 불변식 | 확인 방법 |
|---|---|
| 요청당 원장 1개 이하 | `bid_ledger.bid_request_id` unique 및 요청/원장 수 비교 |
| 최종가 단조 증가 | 같은 `auction_id`의 승인 원장 `decided_at` 순서 확인 |
| 경매 값 일치 | `auction.current_price/current_winner_id`와 마지막 승인 원장 비교 |
| 종료 결과 1개 | `auction_result`와 `AuctionEnded` Outbox가 각각 최대 1행 |
| Consumer 중복 효과 없음 | `consumer_event(consumer_name,event_id)` PK와 Projection 결과 비교 |

## 4. B. 부하·장애 주입과 측정

### 4.1 k6 부하 프로필

| 단계 | 부하 | 시간 | 목적 |
|---|---:|---:|---|
| Warm-up | 5 VU | 30초 | 연결·캐시·JIT 안정화 |
| Steady | 20 VU | 2분 | 정상 P95·오류율·Lag 측정 |
| Contention | 같은 auctionId에 20 요청 | 1회 | 순서·원장·가격 정합성 |
| Recovery | 부하 중지 뒤 관측 | 최대 60초 | Consumer Lag 0 회복 |

k6는 API 응답 시간과 상태 코드를 JSON summary로 저장한다. 최종 결과 WebSocket 지연은 `correlationId`/`eventId`를 기준으로 서버 이벤트 시각과 수신 시각을 비교한다. 이후 #93의 구조화 로그가 이 상관관계를 자동 수집한다.

### 4.2 장애 주입

| 대상 | 주입 | 기대 결과 | 복구 확인 |
|---|---|---|---|
| Redis | 테스트 대상 Redis Container만 stop/start | 입찰 Worker는 offset을 완료하지 않음 | 재시작 뒤 `NOT_ACTIVE` 단일 경매 복구·원장 수렴 |
| OpenSearch | OpenSearch Container stop/start | 검색 API는 명확한 오류, 입찰·등록 성공 | 재시작 뒤 Consumer 재시도 또는 재색인 |
| Kafka Consumer | Application Consumer만 중지/재시작 | 접수는 유지, Lag 증가 | 중복 eventId 효과 없이 Lag 0 |
| Kafka DLT | 계약 위반 Event 발행 | 즉시 DLT, 무한 재시도 없음 | 원본 eventId·실패 Header 확인 |

장애 주입은 `make local-up`으로 만든 BidFlow 전용 Compose service만 대상으로 한다. 사용자의 다른 Docker Container, 로컬 데이터베이스, 홈 디렉터리는 건드리지 않는다.

## 5. I. 로컬 실행 환경과 관측 지점

```text
k6
  → Spring Boot API
  → PostgreSQL / Kafka / Redis / OpenSearch (Docker)
  → Kafka Consumer / WebSocket Projection

수집: k6 summary + PostgreSQL 검증 SQL + Kafka consumer-group lag + Docker stats + 애플리케이션 로그
```

실험 시작 전 다음을 기록한다.

- Mac 모델·메모리, macOS 버전, Docker Desktop 버전과 CPU/메모리 제한
- Git commit SHA, Java·Node·k6 버전
- Compose service 상태와 Topic partition 수
- 실행 시각, Fixture 식별자, 실행 명령

## 6. T. 통과·중단 기준

### 6.1 통과 기준

| 지표 | 기준 | 이유 |
|---|---:|---|
| 입찰 접수 API P95 | 300ms 이하 | 프로젝트 성공 기준과 일치 |
| HTTP 오류율 | 1% 이하, 의도적 장애 제외 | 정상 부하의 안정성 |
| 접수→최종 결과 P95 | 2초 이하 | 비동기 처리 사용자 경험 |
| 부하 종료 뒤 Consumer Lag | 60초 안에 0 | 처리량보다 회복성 검증 |
| 원장/종료 불변식 위반 | 0건 | 경매 정합성은 성능보다 우선 |
| Redis/OpenSearch 장애의 원장 손상 | 0건 | 파생 저장소 장애 격리 |

### 6.2 중단·무효 기준

- 호스트 CPU가 지속 90% 이상이거나 메모리 압박으로 Docker OOM이 발생하면 해당 실행을 성능 결과로 사용하지 않고 환경 상태를 남긴 뒤 낮은 VU에서 재실행한다.
- Kafka/Redis/OpenSearch가 준비되지 않은 상태에서 시작한 실행은 무효다.
- 의도하지 않은 외부 Container·데이터에 영향을 준 경우 즉시 중단하고 대상 범위를 수정한다.

## 7. 증적 산출물과 순서

1. #95: `tests/load/`의 k6 스크립트와 JSON summary, SQL 정합성 검증
2. #96: 장애 주입 스크립트와 전후 상태·Lag·DLT Header 증적
3. #97: Kafka 선택의 순서·Lag·비용 결과 비교
4. #102: 환경 정보, 결과 표, 실패 원인, 한계와 AWS 재측정 계획

결과 원본은 민감한 접속 정보·Cognito 토큰을 제외하고 `docs/reports`에 보관한다. 실패한 실행도 삭제하지 않고 실패 원인과 다음 조치를 남긴다.

## 8. 완료 조건

- [x] S/D/B/I/T별 부하·장애 대상과 성공 기준을 정의했다.
- [x] 고정 Fixture와 PostgreSQL 정합성 검증 기준을 정의했다.
- [x] k6 부하 단계, 장애 주입 범위, 수집 지표를 정의했다.
- [x] 로컬 Apple Silicon 환경의 한계와 AWS 재측정 경계를 명시했다.
