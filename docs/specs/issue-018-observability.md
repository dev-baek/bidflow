# [Issue #90] 로그·지표·알람·추적 사양

- 상태: 제안됨
- 관련 Issue: [#90 로그·지표·알람·추적 사양 작성](https://github.com/dev-baek/bidflow/issues/90)
- 후속 구현: #93 구조화 로그와 요청·이벤트 추적, #92 CloudWatch Dashboard·Alarm
- 상위 사양: [부하·장애 실험 계획](issue-019-load-failure-test.md)

## 1. 목적과 비목적

운영자와 개발자는 하나의 입찰을 **HTTP 접수 → Outbox → Kafka → Bid Worker → 원장 → Projection** 순서로 추적할 수 있어야 한다. 상관관계 식별자는 성능 지표의 Tag가 아니라 로그 탐색 키다.

이 단계는 분산 추적 SaaS, 사용자 행동 분석, 전문 Log 저장소를 새로 도입하지 않는다. 로컬은 표준 출력(JSON), AWS 검증 환경은 CloudWatch Logs와 Metric/Alarm을 대상으로 한다.

## 2. S. 사용자·운영자 관점

| 상황 | 운영자가 확인할 것 | 시스템 동작 |
|---|---|---|
| 정상 입찰 | 요청의 `correlationId`, `bidRequestId`, 최종 결과 | API는 접수 로그를, Worker는 처리 완료 로그를 남김 |
| 중복 요청 | 같은 `Idempotency-Key`가 기존 요청을 반환했는지 | 새 원장/이벤트를 만들지 않았음을 결과 코드로 기록 |
| Redis 복구 | 어떤 `auctionId`가 `NOT_ACTIVE` 뒤 복구됐는지 | 복구 시작·성공/실패와 재실행 결과를 기록 |
| Kafka 재시도/DLT | 어느 Topic/Partition/Offset이 왜 실패했는지 | 재시도는 경고, DLT 전송은 오류로 기록 |
| 검색 장애 | 검색만 실패하고 등록·입찰은 계속되는지 | 검색 오류와 독립 기능의 정상 로그를 구분 |

`X-Correlation-Id`가 유효한 경우 API는 그대로 사용하고 응답 Header에도 같은 값을 돌려준다. Header가 없거나 공백이면 서버가 UUID를 생성한다. Header 값은 길이 128자 이하의 영문자·숫자·`-`·`_`·`.`만 허용하며, 나머지는 새 UUID로 교체한다. 인증 Token, Cookie, 요청 본문, 최대 자동 입찰가와 이미지 URL은 로그에 남기지 않는다.

## 3. D. 식별자와 로그 데이터 계약

### 3.1 식별자 역할

| 식별자 | 생성/전파 | 용도 | 저장/노출 경계 |
|---|---|---|---|
| `correlationId` | HTTP Filter가 생성하거나 Header를 채택, Event Envelope로 전파 | 한 사용자 요청과 그 비동기 처리를 연결 | Log/MDC, `bid_request`, Outbox, Event Envelope |
| `bidRequestId` | 멱등 요청 접수 시 생성 | 한 입찰 명령·원장 결과 식별 | DB·Event payload·로그 |
| `eventId` | Outbox 생성 시 생성 | Event 재발행·Consumer 멱등성 식별 | Outbox·Envelope·`consumer_event`·로그 |
| `auctionId` | 경매 생성 시 생성 | 경매별 순서·복구 단위 | Kafka Key·DB·로그 |

`correlationId`는 사용자 식별자나 비밀값이 아니다. 요청마다 다른 값이며, Metric Label·OpenSearch Document field·DB Index로 만들지 않아 고카디널리티 비용을 피한다.

### 3.2 JSON 로그 공통 필드

모든 애플리케이션 로그는 최소 다음 필드를 포함한다. 필드가 없는 경우 JSON `null` 대신 기록하지 않는다.

| 필드 | 예시 | 필수 대상 |
|---|---|---|
| `timestamp` | `2026-11-14T12:00:00Z` | 모든 로그 |
| `level` | `INFO`, `WARN`, `ERROR` | 모든 로그 |
| `event` | `bid.request.received` | 업무·장애 로그 |
| `correlationId` | `run-001-...` | HTTP 요청과 Event Consumer |
| `bidRequestId` / `eventId` / `auctionId` | UUID | 해당 Aggregate가 있을 때 |
| `topic`, `partition`, `offset`, `consumerGroup` | `bid-command`, `0`, `42` | Kafka Consumer/Publisher |
| `outcome` | `RECEIVED`, `ACCEPTED`, `REJECTED`, `DUPLICATE`, `DLT` | 결과가 있는 로그 |
| `failureCategory` | `TRANSIENT`, `CONTRACT` | 실패/재시도/DLT |
| `durationMs` | `18` | HTTP 완료·외부 I/O 완료 |

예외는 class와 안전하게 제한한 message만 남긴다. `stacktrace`는 `ERROR`에서만 허용하며, payload 전체를 직렬화하지 않는다.

## 4. B. 백엔드 전파와 기록 지점

### 4.1 HTTP 경계

1. `OncePerRequestFilter`가 `X-Correlation-Id`를 검증하거나 새 값을 만든다.
2. Filter는 처리 범위 동안 MDC의 `correlationId`를 설정하고, 응답 Header에 반환한다.
3. `finally`에서 MDC를 반드시 제거한다. Thread pool 재사용에 이전 요청 값이 남아서는 안 된다.
4. Controller는 `bid.request.received`를 `bidRequestId`·`auctionId`·`outcome=RECEIVED`와 함께 기록한다. 금액과 자동 입찰 최대가는 기록하지 않는다.

### 4.2 Outbox와 Kafka

- Outbox Publisher는 `event.published`에 `eventId`, `correlationId`, Topic, Key를 기록한다.
- Kafka Listener는 Envelope의 `correlationId`를 MDC에 설정하고, Record의 Topic/Partition/Offset/Consumer Group을 함께 기록한다.
- 처리 완료는 `bid.settled`, `projection.indexed`, `realtime.published`, `auction.closed`처럼 결과별 Event name을 사용한다.
- Listener도 `finally`에서 MDC를 제거한다. 메시지별 MDC scope는 다른 Record로 전파되지 않는다.
- Kafka Error Handler는 retry 횟수와 실패 분류를 기록하고, DLT 전송 시 원본 Topic/Partition/Offset, `eventId`, `correlationId`를 오류 로그에 남긴다.

### 4.3 복구와 종료

- Redis `NOT_ACTIVE`는 `auction.recovery.started` 경고를 남긴다.
- Snapshot 복구와 재실행 성공은 `auction.recovery.completed`, 재실행 실패는 `auction.recovery.failed` 오류를 남긴다.
- 경매 종료 Scheduler는 점유·종료·이미 종료됨을 각각 구분해 기록한다. 반복 Polling마다 성공 로그를 남겨 로그량을 늘리지 않는다.

업무 규칙은 기존 Domain/Application에 둔다. Filter, Listener, Scheduler, Publisher는 식별자 scope와 입출력 로그만 맡는 Imperative Shell이다.

## 5. I. 지표·Dashboard·알람 계약

### 5.1 지표

| 지표 | Type/Tag | 목적 |
|---|---|---|
| `http.server.requests` | Timer: method, uri, status | API P95·오류율 |
| `bidflow.bid.request.received` | Counter: kind, outcome | 접수·중복 요청 추이 |
| `bidflow.bid.settlement` | Counter/Timer: outcome | 승인·거절·처리 시간 |
| `bidflow.auction.recovery` | Counter: outcome | Redis 복구 발생·실패 |
| `bidflow.kafka.dlt` | Counter: topic, failureCategory | 계약 오류와 일시 오류 분리 |
| Kafka Consumer Lag | Broker 지표: group, topic, partition | 부하 뒤 회복과 Consumer 중단 탐지 |
| Outbox 미발행 건수·최고 지연 | Gauge | Publisher 정체 탐지 |

`correlationId`, `eventId`, `bidRequestId`, 사용자 ID, 예외 message는 Metric Tag에 넣지 않는다. `auctionId`도 Tag로 넣지 않는다.

### 5.2 검증 환경 Dashboard

CloudWatch Dashboard는 API 오류율/P95, 입찰 접수·결과, Kafka Lag, DLT 수, Outbox 지연, Redis 복구, EC2 CPU·메모리를 한 화면에서 보여준다. Log Insight는 `correlationId`로 API와 Consumer 로그를 연결해 검색한다.

### 5.3 Alarm 초안

| Alarm | 초안 기준 | 최초 대응 |
|---|---|---|
| API 오류율 | 5분 동안 1% 초과, 의도적 장애 제외 | correlationId별 4xx/5xx와 최근 배포 확인 |
| API P95 | 5분 동안 300ms 초과 | DB/Redis/Kafka 지연과 CPU 확인 |
| Consumer Lag | 부하 종료 뒤 60초 내 0이 되지 않음 | Consumer 상태·재시도·DLT 확인 |
| DLT | 1건 이상 | 원본 eventId·Header를 확인하고 계약/일시 오류 분류 |
| Outbox 지연 | 5분 이상 미발행 Row 존재 | Publisher와 Kafka 연결 확인 |
| 복구 실패 | 1건 이상 | 해당 auctionId 원장과 Redis 상태를 비교 |

임계값은 #94의 로컬 성공 기준을 시작점으로 삼는다. 단일 Mac 실험값을 운영 SLO로 확정하지 않고 AWS 단기 검증에서 재측정한다.

## 6. T. 검증 기준

| 조건 | 자동 검증 | 기대 결과 |
|---|---|---|
| 유효 Header | Filter 단위 테스트 | 같은 `correlationId`가 MDC·응답 Header에 존재 |
| Header 누락/무효 | Filter 단위 테스트 | 새 UUID를 생성하고 이전 MDC가 남지 않음 |
| 정상 입찰 Event | Listener 단위 테스트 | Envelope correlationId와 Kafka 위치가 로그 context에 설정 |
| Listener 예외 | Listener/Error Handler 테스트 | MDC가 제거되고 실패 분류·DLT 식별자가 기록 |
| 멱등 재소비 | Consumer 통합 테스트 | 처리 효과는 한 번, 로그 outcome은 `DUPLICATE`로 구분 가능 |
| Redis 복구 | Recovery 통합 테스트 | 시작/성공 또는 실패 이벤트가 각각 한 번 기록 |
| 고카디널리티 방지 | Meter 등록 테스트 | 식별자가 Metric Tag에 포함되지 않음 |

테스트는 Logback Appender 또는 주입 가능한 관측 Port로 이벤트·MDC를 읽는다. 실제 CloudWatch 전송은 #92/#91의 단기 AWS 검증에서 확인하며, 로컬 테스트가 AWS Alarm 전달을 증명한다고 주장하지 않는다.

## 7. 완료 조건

- [x] correlationId와 bidRequestId/eventId/auctionId의 책임·전파 경계를 정했다.
- [x] 로그 필드, 민감 정보 금지, MDC 정리 규칙을 정했다.
- [x] HTTP·Outbox·Kafka·복구별 기록 지점을 정했다.
- [x] 지표·Dashboard·Alarm의 초기 기준과 고카디널리티 금지 규칙을 정했다.
- [x] #93 구현과 #92 AWS 관측 검증의 테스트 경계를 정했다.
