# [Issue #19] 로컬 재시작 직후 E2E 시간 초과 관측 사양

- 상태: 제안됨 — 승인 후 수집 연결·테스트·실측.
- 관련: [#19 검증](https://github.com/dev-baek/bidflow/issues/19), [#20 E2E](https://github.com/dev-baek/bidflow/issues/20).
- 근거: [로컬 100ms 검증의 초기 시간 초과](../reports/issue-019-local-outbox-delay.md). 첫 기능 실행은 2개 시간 초과, 사후 DB에서는 종료/승인 반영, 한 번의 재실행은 6개 통과였다.

## S. 관측 목표와 현재 경계

새 API JVM이 HTTP 요청을 받기 시작한 때와 비동기 입찰/종료 결과를 처리·전파하는 때를 구분한다. 초기 실패가 Kafka 준비 지연, 이전 JVM 종료 지연, Outbox 대기, 결과 전파 중 어디와 함께 발생하는지 확인한다. 현재 증거로 특정 원인을 확정하거나 100ms 설정의 회귀라고 단정하지 않는다.

현재 `ReadinessEndpointTest`는 `/actuator/health/readiness`의 HTTP 200과 UP만 검사한다. Kafka 파티션 할당을 포함한 사용자 정의 readiness 검사는 없다. Spring Boot의 기본 readiness 그룹에도 외부 시스템 검사가 자동으로 추가되지는 않는다. [Spring Boot 3.5 공식 설명](https://docs.spring.io/spring-boot/3.5/reference/actuator/endpoints.html#actuator.endpoints.kubernetes-probes.external-state)

이번 단계는 **관측**이다. ALB health 계약·readiness/liveness 구성·API 접수 조건·Kafka 설정·Outbox 간격·테스트 timeout을 바꾸지 않는다. 고정 sleep이나 Consumer 할당 완료 대기로 첫 테스트를 늦춰 초기 상태를 숨기지 않는다.

## D. 증적과 시계

DB schema·인덱스·데이터 초기화는 없다. 새 경매만 사용하고 기존 데이터·볼륨·처리 기록·Kafka offset을 지우거나 되감지 않는다.

실행자는 같은 프로세스의 단조 시계로 아래 관측을 기록한다. 시각은 실제 내부 동작 시각이 아니라 **로그/응답/표시를 수신한 시각**이다. Java 업무 Clock이나 서버 wall clock과 빼서 지연을 만들지 않는다.

| 관측 | 보존할 필드 |
|---|---|
| 이전 JVM 종료·새 JVM 시작 | 검증된 PID, 실행/종료 결과, 상대 시각, jar hash·commit·안전한 실행 인자 |
| HTTP 상태 | health/readiness 구분, 상대 시각, HTTP status, 허용된 UP/DOWN/OUT_OF_SERVICE/UNKNOWN 값. 연결 실패·timeout은 별도 결과 |
| Kafka 할당/회수 | logger 검증 후 알려진 group, topic/partition 목록, 할당/회수 구분, 수신 상대 시각 |
| 업무 처리 | 기존 Outbox 허용 필드와 `bid.settled`의 eventId/requestId/auctionId·outcome, 수신 상대 시각 |
| E2E 시작/종료 | 고정 사례 식별자, 시작/종료 표시, passed/failed/timedOut/skipped 구분. 원문 예외는 제외 |
| 사후 SQL | 해당 경매의 상태/version, 요청/원장/결과 이벤트 연결, 관측 시각. 사후 완료와 timeout 당시 완료를 구분 |

실제 사용자 ID·금액·최대 자동입찰가·Token·원문 payload·전체 framework message·예외 원문·trace는 공개 증적에 넣지 않는다. 기존 trace가 필요하면 로컬에서만 확인하고 필요한 상태/식별 정보만 추출한다. 원본 source/line을 보존해 같은 행의 중복 투입을 거부한다.

## B. 기존 로그와 테스트 재사용

`application.yml`의 health probe, 기존 INFO JSON 로그, Outbox 계측·`bid.settled`, 현재 Playwright 사례를 재사용한다. 새 endpoint·메트릭 서비스·런타임 준비 상태 API를 도입하지 않는다.

Kafka 할당/회수는 현재 의존 버전의 `KafkaMessageListenerContainer` INFO 로그 중 알려진 형식만 파싱한다. group은 `bid-settlement`, `realtime-projection`, `auction-finalization`, `search-projection`, topic은 `bid-command`, `bid-event`, `listing-event`만 허용한다. 원문 메시지 전체를 저장하지 않는다. 형식/버전 차이로 해석하지 못한 할당은 **미관측**이며 준비 완료로 대체하지 않는다. Consumer thread 시작이나 `isRunning`만으로 파티션/업무 준비 완료를 판단하지 않는다. [Spring Kafka 3.3 lifecycle 이벤트의 경계](https://docs.spring.io/spring-kafka/reference/3.3/kafka/events.html)

첫 두 기능 사례(공개 유찰, 자동입찰 낙찰 불변)의 시작/종료는 Playwright reporter 경계에서 관측한다. 테스트 본문·원래 단언·10초/15초 제한을 유지한다. 각 사례의 모든 경매 ID를 사후 연결할 수 있도록 현재 응답/테스트 산출물에서 제한된 식별자만 수집한다. 사례 상태와 전체 runner exit code를 모두 보존한다.

파싱·시간 순서 검증·사례별 요약은 순수 함수로, 프로세스·HTTP·로그/SQL 수집은 경계에서 수행한다. 새로운 외부 의존성은 추가하지 않는다.

## I. 세 번의 제한된 재시작

1. 같은 commit·bootJar·Vite·Docker를 유지한다. 기존 API의 PID·cwd/실행 인자를 확인하고 정상 종료한다. **포트 해제만 보지 말고 JVM 완전 종료를 최대 60초 확인**한다. 끝나지 않으면 새 API를 띄우지 않고 setup 실패로 중단한다. 다른 사용자 프로세스나 컨테이너는 중단하지 않는다.
2. `local,e2e`, localhost, 간격 override 없이 새 JVM을 시작한다. local 기본 100ms·기본 INFO를 사용한다. 세 회차 모두 같은 조건이다. 별도 k6·기능 테스트·수동 Clock 변경을 겹치지 않는다.
3. 수집은 JVM 시작 전부터 준비한다. HTTP probe는 순차 요청으로 약 200ms 간격, 요청 timeout 1초, 시작 후 전체 90초 상한을 둔다. health와 readiness의 상태/첫 UP을 각각 남기고, **첫 readiness UP을 관측하면 곧바로** 첫 두 E2E를 시작한다. 시작 기준은 readiness UP이며 health UP은 대체 조건이 아니다. readiness 응답이 없으면 시작하지 않는다. probe 요청이 느릴 때 실제 간격도 보존한다.
4. readiness UP 뒤 추가 sleep·워밍업·사전 입찰·Kafka CLI 완료 대기를 넣지 않는다. Kafka 할당은 동시에 받는 로그로 관측한다. CLI Lag가 필요하면 테스트 종료 후 읽기 전용 snapshot으로만 확인하고 초기 할당 시각의 증거로 쓰지 않는다.
5. worker 1개로 두 사례를 실행하고 완료/실패 원본을 남긴다. 각 사례의 원래 timeout은 유지하고 runner 전체는 120초 이내로 제한한다. 실패했다고 같은 JVM에서 성공할 때까지 반복하지 않는다. 회차마다 새 JVM·새 경매를 사용한다.
6. runner 종료 뒤 해당 경매만 읽기 전용 SQL로 확인한다. 로그 반영이 늦으면 종료 후 수집을 최대 5초 더 유지하되, 그동안의 결과를 기존 timeout 안에 완료된 것으로 바꾸지 않는다. 결과가 더 늦으면 미확정으로 남긴다.
7. 최대 3회 재시작한다. setup/수집 실패도 보고하고 성공 회차로 대체하지 않는다. 테스트 성공 횟수를 채우려고 네 번째 회차를 추가하지 않는다.
8. 종료/실패 모두 원래 `local / 명시적 1,000ms / INFO` 실행 상태로 복원한다. 실제 listen PID·인자·health를 검증한다. 새 기본값 100ms와 원래 프로세스의 명시적 override는 구분한다. 복원 실패 시 성공으로 보고하지 않는다.

## T. 판정과 후속 조치

구현 전에 다음 fixture 테스트를 RED로 추가한다.

- health/readiness를 혼동하지 않고, 연결 실패나 health만 UP인 상태에서 테스트를 시작하지 않는다. 준비 관측 timeout·이전 JVM 미종료·자식 종료 실패는 유효한 테스트 결과가 아니다.
- 할당/회수·다른 group/topic·알 수 없는 형식을 구분한다. thread 시작이나 빈 파티션 목록을 전체 업무 준비 완료로 계산하지 않는다.
- source/line 중복·필수 시각 누락·단조 시계 역행·잘못된 사례 순서·exit code와 사례 상태 불일치를 거부한다. 사후 완료를 기한 내 성공으로 바꾸지 않는다.
- 허용 필드만 출력하며 payload/Token이 들어간 fixture에서도 원문이 증적에 남지 않는다. HTTP/프로세스 오류도 제한된 실패 코드로 남긴다.

보고서는 회차별 첫 health/readiness UP, 각 group의 첫/후속 할당·회수, 두 사례의 시작/종료·실패 단계, 같은 request/event의 처리 관측을 나란히 제시한다. 파티션 할당은 업무 결과 전달의 충분조건이 아니며, 수집 누락은 실제 동작 부재의 증거가 아니다.

timeout과 뒤늦은 할당/처리가 같은 회차에서 관측되면 startup 지연 가설을 지지하는 자료로 남기되 단독 원인으로 확정하지 않는다. DB 결과가 먼저 확인됐는데 화면이 늦으면 결과 전파/UI 경로를 다음 조사 대상으로 구분한다. 세 회차에서 재현되지 않으면 **미재현**으로 보고하며 수정 완료로 선언하지 않는다.

readiness gating·배포 health 변경·워밍업 도입은 관측 결과를 검토한 다음 별도 사양/구현으로 판단한다. 이 단계에서 AWS에 접근하거나 리소스를 생성하지 않으며 #19/#20을 자동으로 닫지 않는다.
