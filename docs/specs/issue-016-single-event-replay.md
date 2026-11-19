# [Issue #16] 로컬 단일 검색 이벤트 DLT 재처리

- 상태: 사양 승인(#253), 순수 검증·CLI·감사 기록 구현. [새 로컬 장애 Fixture의 재처리·중복 검증 실측](../reports/issue-016-listing-replay-recovery.md) 완료.
- 기존 이슈: [#16 중복 이벤트·Consumer 장애·Redis 복구](https://github.com/dev-baek/bidflow/issues/16)
- 상위 계약: [이벤트 실패·복구](issue-016-failure-recovery.md)
- 배경: [OpenSearch 장애 실측](../reports/issue-096-opensearch-recovery.md)에서는 DLT 격리 뒤 PostgreSQL 전체 재색인으로 복구했다. DLT의 원본 이벤트를 다시 발행하는 도구와 실측은 아직 없다.

## S. 운영 흐름과 제외 범위

운영자는 로컬 OpenSearch 장애의 원인을 해결한 뒤 **명시한 DLT 위치 한 건**을 점검하고 재발행한다. 새 화면·자동 재시도 루프·범위 일괄 재처리는 만들지 않는다.

첫 구현은 `listing-event.DLT`의 `TRANSIENT_EXHAUSTED` 이벤트 중 기존 검색 Listener가 처리하는 `ListingPublished`, `ListingUpdated`, `ListingUnpublished`만 허용한다. 대상 토픽은 사용자 입력으로 받지 않고 `listing-event`로 고정한다. 검색 Listener는 과거 payload의 가격을 덮어쓰지 않고 현재 PostgreSQL 상품 Snapshot을 읽어 색인한다.

`bid-command.DLT`, `bid-event.DLT`, 계약 오류·업무 불변식 실패는 이번 도구로 재처리하지 않는다. 오래된 입찰 명령을 로그 끝에 붙여 경매 순서를 바꾸거나, 종료·실시간 효과를 다시 수행하는 위험을 피한다. 이 제한은 #16의 모든 DLT 종류를 구현했다는 의미가 아니다.

## D. 원본과 감사 기록

- 입력: DLT partition·offset, 기대 `eventId`, 운영자 식별자. partition·offset은 0 이상 정수이고 운영자 값은 공백만인 값을 거부한다.
- DLT의 `x-original-topic`, `x-original-partition`, `x-original-offset`, `x-failure-class`를 검사한다. 필수 헤더 누락·중복·잘못된 숫자·원본 토픽 불일치를 거부한다.
- 정상 JSON Envelope, 알려진 schemaVersion·eventType, 유효한 productId 및 `key == productId` 계약을 기존 검증 규칙으로 검사한다. 과거 이벤트라는 이유로 `occurredAt`을 현재 시각으로 바꾸지 않는다. 미래 시각 검증은 기존 Consumer 계약을 따른다.
- 원본 key·value와 `eventId`·`correlationId`를 그대로 재사용한다. 진단/오류 헤더를 새 실패로 오인하지 않도록 재발행 헤더는 `x-replay-id`, `x-replayed-at`, `x-replayed-by`만 생성한다. 원본 실패 정보는 DLT와 감사 기록에 남긴다.
- 감사 JSONL에는 replay ID, 실제 UTC 실행 시각, 운영자, eventId, DLT 위치, 원본 위치, 대상 위치(확인된 경우), 결과를 기록한다. payload·API 키·URL 자격 증명·예외 전체 텍스트는 저장하지 않는다. 기록 파일은 저장소 밖의 명시한 경로에 배타적으로 새로 만들며 기존 파일을 덮어쓰지 않는다.
- DB 마이그레이션, 원본 DLT 삭제, `consumer_event` 삭제, consumer group offset 재설정은 하지 않는다.

## B. 구현 책임

기존 Kafka Java Client와 Event 계약 검증을 재사용하는 일회성 로컬 CLI로 구현한다. Spring 서버·Scheduler·다른 Listener를 함께 기동하지 않는다. 별도 HTTP 관리 API는 추가하지 않는다.

계약 검증과 재발행 레코드 구성은 순수 함수로 분리한다. Kafka 읽기/발행, 실제 Clock, replay ID 생성, 감사 파일 쓰기는 경계에서 수행한다. 원본 payload를 재직렬화해 변경하지 않는다.

DLT는 지정 partition에 직접 할당하고 정확한 offset부터 제한 시간 동안 조회한다. 첫 레코드가 기대 offset과 다르면 실패한다. 기대 eventId도 일치해야 한다. 유효한 레코드라면 원본 partition의 존재를 확인하고 **같은 원본 partition**에 재발행한다. Consumer 자동 커밋은 끄고 어떤 기존 그룹의 offset도 변경하지 않는다.

## I. 실행 안전장치

1. 기본 동작은 조회·검증만 하는 dry-run이다. 실제 발행에는 명시적 `--execute`가 필요하다.
2. bootstrap server는 로컬 loopback 주소만 허용한다. AWS broker·임의 원격 주소·자격 증명은 받지 않는다. Kafka metadata 연결 실패도 성공으로 처리하지 않는다.
3. 실행 전에 레코드 검증과 감사 파일 생성/쓰기 가능 여부를 확인하고 `ATTEMPTED` 기록을 저장한다. 이후 최대 한 번의 명시적 send를 수행하며, producer acknowledgment의 토픽·partition·offset으로 `PUBLISHED`를 기록한다.
4. acknowledgment 또는 감사 기록 저장이 실패하면 성공을 보고하지 않는다. 이미 broker에 기록됐을 수 있는 경우 `UNKNOWN`으로 취급하며 자동 재발행하지 않는다. 운영자가 대상 로그와 처리 기록을 확인한 뒤에만 같은 eventId로 다시 실행한다. 파일 쓰기 자체가 불가능하면 종료 상태와 안전한 메시지로 알리고 성공으로 간주하지 않는다.
5. `PUBLISHED`는 Kafka 발행 확인일 뿐 색인 복구 완료가 아니다. 검색 Consumer 처리 기록과 실제 검색 API 응답을 별도로 확인해야 `RECOVERED`라는 실험 판정을 내린다.

dry-run·오류는 Kafka/DB 상태를 쓰지 않는다. 실행 모드라도 기존 데이터·볼륨·인덱스를 삭제하거나 보존 기간을 바꾸지 않는다. 종료 시간·레코드 크기 제한을 두어 전체 DLT를 훑지 않는다. AWS 검증은 별도 승인 범위로 남긴다.

## T. 실패 테스트와 로컬 인수 검증

| 대상 | 확인할 동작 |
|---|---|
| 순수 검증 | 허용 토픽·종류·실패 분류·key, eventId 일치. payload bytes 및 ID 불변. 기존 헤더 혼입 없음 |
| 거부 경계 | 다른 토픽/분류, 잘못된 Envelope, 헤더 누락/중복, 잘못된 offset, 기대 ID 불일치, 원격 주소는 발행 0회 |
| 실행 제어 | dry-run 발행 0회, execute 한 레코드만 발행. 감사 파일 충돌·쓰기 불가면 발행 전 중단 |
| I/O 실패 | 조회 timeout·레코드 없음·offset 공백·send 실패·ack 후 파일 실패를 성공으로 표시하지 않음 |
| 검색 복구 | 새 Fixture의 실패 이벤트를 DLT에서 특정해 실행하고 같은 eventId의 성공 처리와 API 검색 결과 확인 |
| 중복 재처리 | 같은 DLT를 별도 감사 파일로 다시 실행해도 `consumer_event` 성공 행과 검색 문서 ID는 하나. 원장 변경 없음 |

구현은 위 경계의 실패 테스트부터 추가한다. 실제 인수 검증은 기존 #96 실험처럼 **새 시험 상품**을 OpenSearch 중단 중 등록해 `TRANSIENT_EXHAUSTED`로 격리한 뒤, 반드시 서비스를 복구하고 수행한다. 기존 DLT 사건을 무단 재사용하거나 전체 재색인으로 성공을 대신하지 않는다. 중단한 OpenSearch는 실험 실패 때에도 다시 시작한다.

보고서에는 기준 commit, DLT/원본/재발행 위치, eventId, dry-run과 execute 결과, 검색 처리 전후, 동일 이벤트 재실행 결과를 남긴다. Kafka 발행 성공·소비 성공·업무 복구를 각각 구분한다. 문서 PR 단계에서는 실제 재처리가 완료됐다고 표시하지 않는다.

## 구현 진행

- `ListingEventReplayPlan.prepare`는 기대 DLT 위치·eventId·필수 단일 헤더와 기존 Envelope/Contract 검증을 수행한다. 알려진 schemaVersion 1과 검색 이벤트 3종만 허용한다.
- 레코드 key/value는 바이트 배열을 복사해 보존하고, 원본 partition과 진단 위치를 결과로 반환한다. UTF-8 오류·tombstone·1 MiB 초과 payload는 거부한다. 시간과 replay ID는 인자로 받아 I/O 없이 테스트한다.
- `ListingEventReplayPlanTest` 및 기존 Kafka 실패 분류·검색 Listener 테스트로 정상 구성과 거부 경계를 확인한다. 이 단계의 plan은 Kafka partition 존재 확인이나 발행을 수행하지 않는다.
- `ListingEventReplayCli`는 loopback 전용 입력, 직접 assign/seek와 제한된 poll, 원본 partition 존재 확인을 연결한다. 기본 dry-run에는 Producer와 감사 파일을 만들지 않는다. execute는 저장소 밖의 새 파일에 `ATTEMPTED`를 flush/force한 뒤 1회 send하고 ack를 `PUBLISHED`로 기록한다. 전송/후속 감사 실패는 `UNKNOWN`이며 자동 재발행하지 않는다.
- 새 `ListingPublished` 장애 Fixture로 실제 broker 발행·Consumer 처리·검색 복구와 동일 이벤트 재실행을 검증했다. 다른 DLT 종류와 AWS를 검증한 것은 아니며 #16 전체 범위 완료와 구분한다.

## 로컬 실행 방법

저장소 루트에서 실행한다. Spring 서버가 아닌 독립 `JavaExec`이므로 API·Scheduler·Listener를 추가로 띄우지 않는다. Java 21과 실행 중인 로컬 Kafka가 필요하다.

```sh
# 조회·검증만: 실제 DLT 위치와 기대 eventId를 입력한다.
./backend/gradlew -p backend :runtime:replayListingEvent \
  --args='localhost:9092 2 9 18326eec-aa93-4eb1-b1c3-3d23e7de163c operator'

# 원인을 해결하고 dry-run을 확인한 경우에만 명시적으로 발행한다.
# 예시 경로의 부모 폴더는 먼저 준비하고, 파일은 아직 없어야 한다.
./backend/gradlew -p backend :runtime:replayListingEvent \
  --args='localhost:9092 2 9 18326eec-aa93-4eb1-b1c3-3d23e7de163c operator /tmp/bidflow-replay-unique.jsonl --execute'
```

위 숫자·ID는 사용법 예시이지 실제 재처리 대상으로 승인한 사건이 아니다. 커맨드에 payload·인증정보를 넣지 않는다. 원격 bootstrap·다중 주소·잘못된 인자는 Kafka 생성 전에 거부된다. 정상 broker 메타데이터도 로컬 주소를 광고하는 개발 환경에서만 사용한다.

CLI 실패는 비정상 종료하며 예외 원문 대신 일반 메시지를 출력한다. `ATTEMPTED`만 있거나 `UNKNOWN`이면 전송됐을 수 있으므로 새 명령으로 무조건 재시도하지 않는다. 성공적으로 발행해도 검색 처리 성공 행과 API 응답을 별도로 확인해야 한다. 실제 계정의 AWS 사용은 여전히 범위 밖이다.
