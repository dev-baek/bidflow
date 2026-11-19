# [Issue #19/#18] Outbox 구간 계측 구현·검증

- 사양: [DB 저장·배치·ack 계측](../specs/issue-019-outbox-timing.md)
- 범위: 코드와 migration·발행/로그 테스트. 새 브라우저 20건의 계측 실측은 다음 단계다.

## 구현

- V9는 `enqueued_at`을 기본값 없이 추가한 뒤 새 INSERT용 `clock_timestamp()` 기본값을 설정한다. 기존 행에 과거 시각을 만들어 넣거나 업무 시각을 바꾸지 않는다.
- 미발행 조회는 기존 조건·정렬·limit을 유지하고 DB INSERT→SELECT 관측 age를 내부 `pendingAgeMs`로 전달한다. null은 `MISSING`, 음수는 `INVALID`로 로그에 표시하며 숫자 필드는 생략한다.
- `OutboxPublisher`는 조회 반환 뒤 이벤트별 발행 호출까지 `batchWaitMs`를 주입한 단조 ticker로 잰다. 뒤쪽 이벤트는 앞선 발행·표시 처리의 대기를 포함한다.
- Kafka Adapter는 직렬화/전송 시작부터 future 성공까지 `sendAckMs`를 잰다. ack 성공 로그에는 partition·offset을 포함한다. 실패 시에는 `sendAttemptMs`만 기록하며 ack 성공처럼 표현하지 않는다.
- `event.acknowledged`와 `event.published`는 별개다. ack 후 DB 표시 실패는 `MARK_FAILED`, 전송 실패는 `PUBLISH_FAILED`이며 기존 예외를 전파한다. 기존 `published_at`은 여전히 전달받은 배치 시작 시각을 저장한다.
- 로그는 허용 필드만 구성하고 payload·금액·예외 원문을 직렬화하지 않는다. 계측/로그 전송 오류로 정상 업무 발행을 실패시키지 않는다. 식별자는 로그 연결용으로만 사용한다.

Kafka Envelope·schemaVersion·원본 payload·key와 Scheduler 간격은 그대로다. 이 계측의 DB age는 트랜잭션 시간을 포함하고 wall clock 보정 영향을 받을 수 있으며, 정확한 commit 이후 큐 대기가 아니다. 세 구간을 더해 브라우저 전체 지연으로 간주하지 않는다.

## 테스트

```sh
./backend/gradlew -p backend :application:test --tests '*OutboxPublisherTest' \
  :adapters:test --tests '*OutboxTimingMigrationTest' \
  :runtime:test --tests '*OutboxTimingTest'
./backend/gradlew -p backend check :runtime:bootJar
```

관련 테스트 9개 및 백엔드 전체 check·bootJar가 통과했다.

| 대상 | 확인 |
|---|---|
| PostgreSQL migration | V8에서 만든 행은 V9 이후에도 저장 시각 null. 새 행은 DB 시각, 2030년 업무 시각에도 유효한 age. 미래 저장 시각은 음수로 구분. 기존 payload·occurred_at 보존 |
| Publisher | ack 실패 시 mark 없음, ack 뒤 mark 실패 분류·예외 유지. 앞쪽 이벤트 실행 뒤 다음 이벤트의 배치 대기 증가. 기존 published_at 인자 유지 |
| 무효 관측 | 역행 ticker는 수치 생략. 관측 callback 실패가 발행·표시 성공을 바꾸지 않음 |
| Kafka/로그 | 가짜 ticker 50ms와 ack partition/offset 기록. Envelope 불변, 실패 시 ack 필드 없음, payload·예외 비밀값 없음, MDC 정리 |

전체 Spring 검증이 사용하는 로컬 개발 DB에도 V9 적용을 확인했다. 기존 컬럼·행은 삭제하지 않았으며 새 컬럼은 이전 코드가 읽지 않아도 호환된다. 이 결과를 실제 브라우저 20건의 성능 개선 증거로 사용하지 않는다.

## 다음 검증

다음 회차에서 새 시험 경매의 명령/결과 Outbox eventId를 requestId와 연결하고 허용된 로그 필드만 추출한다. 관측 age·배치 대기·ack 시간의 표본 수와 누락/무효 수를 각각 보고한다. 기존 2초 기준 실패는 계측만으로 해결된 것이 아니며 #19/#18은 열린 상태로 둔다. AWS는 사용하지 않았다.
