# [Issue #19] 로컬 재시작 직후 E2E 3회 관측 결과

## 결론

세 번의 새 JVM에서 공개 유찰·자동입찰 낙찰 불변 사례가 모두 통과했다. 이전 [초기 시간 초과 2건](issue-019-local-outbox-delay.md)은 **이번 조건에서 미재현**이며 수정 완료나 원인 확정으로 처리하지 않는다.

2·3회차에서는 readiness UP 응답을 먼저 받은 뒤 Kafka 할당 로그를 수신했다. 첫 E2E 시작 전에는 네 그룹의 할당 로그가 모두 수집됐다. 수신 순서만으로 실제 내부 할당 순서나 이전 실패의 원인을 확정할 수는 없다. readiness/ALB 계약·대기 정책·테스트 timeout을 바꾸지 않았다.

## 실행 조건과 원본

- 승인 [관측 사양](../specs/issue-019-startup-observation.md), [수집기 구현](issue-019-startup-observation-implementation.md).
- 기준 commit: `26b14524683007cbb527d18ec53d4a7ce6fb05aa`(#272 병합).
- 실행: 2026-11-20 14:00–14:03 UTC. Node 24, Java 21, 같은 bootJar·Vite·Docker 서비스를 사용했다. 버전·컨테이너 ID·인자·jar SHA-256은 [전체 증적](evidence/issue-019-startup-observation.json)에 있다.
- 세 회차 모두 이전 API의 소유권을 확인하고 **JVM 완전 종료 후** 새 `local,e2e` JVM을 시작했다. 포트 해제만으로 종료를 판단하지 않았다.
- local 기본 100ms를 사용했으며 간격 CLI/환경변수 override·`SPRING_APPLICATION_JSON`은 없었다. 기본 INFO를 유지했다.
- 첫 readiness UP 뒤 추가 sleep·워밍업·사전 Kafka CLI 조회 없이 기존 두 사례를 worker 1개로 실행했다. 원래 단언과 10초/15초 제한, runner 120초 상한을 유지했다. 실패를 성공 횟수로 대체하는 추가 회차는 없었다.
- runner 종료 후 해당 경매만 읽기 전용 SQL로 조회하고 로그 수집을 5초 더 유지했다. 각 회차 종료·복원까지 기록한 뒤 다음 회차로 진행했다.

## 시작 순서

아래 단위는 **새 API JVM 시작 마커 수신 이후 초**다. HTTP 응답·로그·reporter 표시를 받은 같은 수집기의 단조 시각을 사용한다.

| 회차 | health 첫 UP | readiness 첫 UP | 첫 E2E 시작 | readiness→E2E 시작 | 결과 |
|---|---:|---:|---:|---:|---|
| 1 | 12.996 | 13.010 | 16.519 | 3.509 | 2개 통과 |
| 2 | 12.349 | 12.365 | 16.202 | 3.836 | 2개 통과 |
| 3 | 미관측 | 14.364 | 17.838 | 3.474 | 2개 통과 |

3회차의 마지막 health 응답은 503/OUT_OF_SERVICE, 이어진 readiness 응답은 200/UP이었다. probe loop는 첫 readiness UP에서 종료됐으므로 이 구간에서 health UP 시각은 없다. **미관측을 0초나 이후에도 계속 DOWN인 상태로 해석하지 않는다.** 순차 HTTP 요청 사이에 상태가 바뀔 수 있으며 두 응답이 같은 순간의 snapshot도 아니다.

readiness UP을 받자마자 runner를 실행했지만 reporter의 첫 사례 시작까지 약 3.47–3.84초가 걸렸다. 별도 대기는 넣지 않았고, 이 구간에는 자식 실행·Playwright 준비·프로세스 간 표시 전달이 포함된다. readiness 직후 수백 ms 안의 첫 업무 요청을 검증한 결과로 확대하지 않는다.

### 그룹별 첫 비어 있지 않은 할당 로그

| 그룹 | 1회차 | 2회차 | 3회차 |
|---|---:|---:|---:|
| bid-settlement | 12.748 | 12.525 | 14.758 |
| realtime-projection | 12.770 | 12.527 | 14.756 |
| auction-finalization | 12.751 | 12.527 | 14.758 |
| search-projection | 12.752 | 12.526 | 14.754 |

2회차에서 마지막 그룹의 첫 할당 로그는 readiness 응답보다 약 162ms 뒤, 3회차는 약 395ms 뒤 수신됐다. 둘 다 첫 사례 시작보다는 앞이었다. 할당 로그의 실제 실행 시각은 수신 시각보다 이를 수 있으며, 할당 자체도 모든 업무 결과 전달의 충분조건은 아니다.

각 회차에 그룹별 할당과 종료 시 회수 로그가 남았고 알려지지 않은 할당 형식은 0개였다. 전체 event 순서와 후속 회수는 원본 `observation.records`/`summary.kafka`에서 확인할 수 있다. 원문 framework message는 보존하지 않았다.

## 사례와 DB 연결

각 회차에 새 경매 3개(유찰 1개, 자동입찰 시나리오 2개)를 사용했다. 총 9개 경매를 UI에서 확인한 UUID로 SQL에 연결했다.

- 회차별 경매 3개 모두 ENDED였고 결과는 UNSOLD 1개·SOLD 2개였다. 해당 사례의 기존 화면·낙찰 불변 단언도 통과했다.
- 회차별 접수/원장은 4개이며 서로 다른 requestId 4개와 일치했다. 승인 3개, 종료 후 새 입찰 거절 1개였다. 경매별 원장 수와 distinct requestId 수가 같아 중복 원장이 없었다.
- 회차별 해당 경매의 Outbox 이벤트 12개가 발행 표시됐다. 명령 4개·결과 4개·종료 3개·연장 1개다. 각 eventId에 ack와 발행 표시 로그가 1개씩 있어 매칭 로그는 24개였다.
- `bid.settled` 4개를 requestId로 연결하고, 로그 eventId가 해당 명령 eventId와 일치하는지 확인했다. 각 요청의 명령 ack·정산 로그·결과 ack **수신 시각**을 원본 `mapped`에 보존했다.

원본에는 해당 JVM의 허용된 다른 이벤트 로그도 있을 수 있다. 위 수치는 새 경매에 SQL로 연결한 범위이며 전체 로그 수와 다르다. 사후 SQL은 timeout 당시 상태를 복원하는 자료가 아니며, 이번에는 timeout 자체가 없었다. 업무 Clock(2030년)이나 DB timestamp와 수집기 시각을 빼지 않았다.

## 검증과 복원

세 수집기 모두 exit 0/valid=true, E2E도 각 exit 0/testsPassed=true였다. 실제 원본으로 `summarizeStartup`을 다시 실행해 집계 일치를 확인했다. source/line·시간 순서·사례/exit code·eventId/원장 연결도 검증했다. 미관측 시각은 null을 유지하고 파생 시각에 음수/NaN을 넣지 않았다.

관련 Node 테스트 34개와 bootJar 확인이 통과했고 jar hash도 전후 일치했다. 제품 테스트는 이번 목표의 두 사례만 세 번 실행했다. 백엔드 전체 check·프런트 컴포넌트 테스트·다른 네 E2E를 다시 실행한 것은 아니다.

각 회차 후 원래 `local / 명시적 1,000ms / INFO`로 복원했다. 마지막 실제 listen PID·실행 인자·health 200도 별도 확인했다. 정상 local 시작의 프로필 기본 100ms와 이 프로세스의 명시적 override는 다르다. 데이터/볼륨 초기화·offset reset·AWS 작업은 없었으며 루트 package-lock.json도 변경하지 않았다.

## 남은 판단

이전 실패와 달리 이번에는 이전 JVM의 완전 종료를 확인했다. 그러나 종료 확인 유무만 바꾼 대조 실험은 아니므로 **이전 JVM 중첩이 원인이었다고 확정하지 않는다.** 모든 회차가 통과해 실패 구간의 원인별 분류 자료도 얻지 못했다.

따라서 초기 실패 증적과 #19/#20의 원인 미확정 상태를 유지한다. 이번 자료만으로 Kafka를 ALB readiness에 묶거나 sleep·timeout을 늘리는 변경은 하지 않는다. 향후 추가 조사가 필요하면 reporter 시작까지의 준비 구간과 이전 실패 환경의 차이를 분리하는 별도 계획을 검토해야 한다. 세 번의 성공을 임의의 재시작·동시 부하·AWS 환경에 일반화하지 않는다.
