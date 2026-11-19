# [Issue #19/#18] Outbox 지연 구간 계측 사양

- 상태: 검토 대기 — DB migration·계측 구현 전
- 관련: [#19 지연 검증](https://github.com/dev-baek/bidflow/issues/19), [#18 관측성](https://github.com/dev-baek/bidflow/issues/18)
- 선행: [동일 요청의 관측 해상도 비교](../reports/issue-019-paired-browser-observation.md), [구조화 로그 계약](issue-018-observability.md)

## S. 목적과 범위

개인 결과 수신 전 남은 지연을 Outbox 선택 대기·배치 내부 대기·Kafka ack 대기로 나눠 확인한다. 이번 작업은 계측이며, 1초 Scheduler 간격·배치 크기·발행 순서·트랜잭션·재시도 정책은 변경하지 않는다. UI나 관리 API도 추가하지 않는다.

`occurred_at`은 업무 시각이고 `published_at`은 현재 구현에서 배치 시작 시각이다. 이 둘의 차이를 대기 시간으로 사용하거나 기존 컬럼의 의미를 몰래 바꾸지 않는다.

## D. 저장 시각과 호환성

`outbox_event.enqueued_at timestamptz`를 nullable 내부 계측 필드로 추가한다. DB INSERT 시점의 실제 시계 `clock_timestamp()`를 기본값으로 사용한다. 업무용 Java `Clock`·이벤트 Envelope의 `occurredAt`과 분리한다.

기존 행의 실제 저장 시각은 알 수 없으므로 backfill하지 않는다. migration은 **기본값 없이 컬럼 추가 → 이후 INSERT용 기본값 설정** 순서로 작성한다. 기존 행은 null을 유지하고, 새 INSERT 경로(등록·입찰 명령·정산·종료)가 컬럼을 생략하면 DB가 기본값을 기록한다. NOT NULL이나 새 인덱스는 추가하지 않는다.

Publisher 조회는 같은 DB의 선택 시각과 저장 시각으로 `pendingAgeMs`를 계산한다. 기존 `findPending`의 미발행 조건·정렬·limit은 유지한다. 과거 null 행은 `MISSING`, 저장 시각이 선택 시각보다 미래면 `INVALID`로 구분하고 수치 표본에서 제외한다. 0으로 대체하지 않는다. 이때도 업무 이벤트 발행은 기존대로 수행한다.

PostgreSQL `statement_timestamp()`는 문장 시작, `clock_timestamp()`는 실행 중 실제 시각이다. 조회 나이는 DB wall clock 기준이라 시계 보정의 영향을 받을 수 있다. 또한 INSERT는 commit보다 앞서므로 **트랜잭션 시간도 포함된 INSERT→선택 관측 age**이며, commit 이후의 순수 큐 대기라고 부르지 않는다. [PostgreSQL 시간 함수](https://www.postgresql.org/docs/17/functions-datetime.html#FUNCTIONS-DATETIME-CURRENT)

volatile 기본값을 컬럼 추가와 동시에 적용하면 기존 행에 migration 시각이 채워지고 테이블 갱신도 필요할 수 있다. 이를 피하려고 두 단계로 분리한다. 원래 없었던 과거 시각을 생성하는 UPDATE는 하지 않는다. [PostgreSQL 컬럼 추가·기본값 변경](https://www.postgresql.org/docs/17/ddl-alter.html#DDL-ALTER-ADDING-A-COLUMN)

## B. 계측 구간과 로그

| 구간 | 시계·경계 | 해석 |
|---|---|---|
| `pendingAgeMs` | DB INSERT 실제 시각 → 미발행 SELECT 문장 시각 | commit 이전 시간 포함, DB wall clock 기준 |
| `batchWaitMs` | 조회 결과 반환 뒤 → 이 이벤트 발행 호출 직전 | 같은 JVM 단조 시계, 배치 앞쪽 이벤트 처리 대기 포함 |
| `sendAckMs` | 이벤트 직렬화/Producer 호출 직전 → Kafka future 성공 | 같은 JVM 단조 시계, 직렬화·Producer 대기·ack 포함 |

뒤의 두 구간은 `System.nanoTime()`처럼 주입 가능한 단조 시계로 측정한다. 위 세 지표를 단순 합산해 브라우저 전체 지연이라고 하지 않는다. DB 반환 비용·Consumer 처리·Projection·브라우저 전달 등 다른 구간이 존재한다.

기존 JSON 로그 형식으로 `event.published`/`event.publish.failed`를 기록한다. `eventId`, `correlationId`, topic, `eventType`, 결과와 계측값을 남긴다. ack 성공 시 broker가 확인한 partition·offset도 기록한다. payload·금액·자동입찰 최대가·Token·이미지 URL·예외 원문은 남기지 않는다.

내부 계측 메타데이터는 Outbox 조회 모델에서만 전달한다. Kafka Envelope·payload·schemaVersion·key는 바꾸지 않는다. ID는 로그 연결용이며 Metric Tag로 추가하지 않는다. 이번에는 새 메트릭 백엔드·추적 SaaS·CloudWatch 리소스를 추가하지 않는다.

## I. 실패·실행 경계

- Kafka ack 성공과 DB `markPublished` 성공을 구분한다. ack 뒤 표시 실패는 재발행될 수 있으므로 발행 완료 상태로 오해하지 않도록 별도 기록한다.
- 기존 `published_at` 기록과 발행 성공/실패의 예외 전파는 유지한다. 계측을 이유로 실패를 삼키거나 실패 행을 성공 표시하지 않는다.
- null/음수 age 같은 계측 무효는 정상 발행을 막지 않는다. 미발행 이벤트를 임의로 삭제하거나 과거 업무 시각을 현재로 수정하지 않는다.
- 시간 변환·유효성 판정·로그 필드 구성은 순수 함수, 실제 시계·DB·Kafka·로그 출력은 경계에서 다룬다. 새 외부 의존성은 필요하지 않다.

## T. TDD와 로컬 검증

| 대상 | 검증 |
|---|---|
| Migration | 이전 schema의 행은 null 유지, migration 후 INSERT는 실제 DB 시각을 자동 기록. 기존 원장·payload 불변 |
| DB 조회 | `occurred_at`이 2030년이어도 새 저장 시각 기준 age를 계산. null·미래 값은 수치 제외, 기존 조회 순서 유지 |
| 단조 타이머 | 가짜 ticker로 배치 대기·ack 소요 시간 경계·0·무효 값 검증. 업무 Clock 변경에 영향 없음 |
| 성공/실패 | Kafka 실패는 mark 호출 없음, ack 후 mark 실패는 별도 결과와 예외 유지, 이벤트 직렬화 불변 |
| 로그 | 식별자·ack 위치·구간 필드 확인, MDC 누수와 금지된 민감 값/예외 원문 없음 |

구현 후 새 브라우저 순차 20건을 실행한다. `bid_request`/Outbox의 eventId 연결로 명령·정산 결과 이벤트를 매칭하고, 허용한 필드만 추출해 계측 증적에 보존한다. 기존 기본 관측·25ms 보조 관측과 같은 requestId로 대조한다. 로그 전체를 증적에 복사하지 않는다.

같은 fixture에서 계측 표본의 수·무효/누락 수를 보고한다. 두 Outbox 단계가 어떤 분포를 보이는지 확인하되, 수집되지 않은 Consumer/네트워크 시간을 나머지 차이만으로 특정하지 않는다. 2초 목표가 실패해도 표본과 원인을 보존한다. AWS 작업은 별도 승인 전까지 수행하지 않는다.
