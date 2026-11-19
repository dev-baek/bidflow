# [Issue #19] 조회 간격 대조 실험용 계측·수집 구현

- 사양: [로컬 A1→B→A2 실험](../specs/issue-019-outbox-delay-experiment.md), 승인 PR #266.
- 범위: DEBUG 계측, 순수 집계, live 입력 수집 CLI, 기존 E2E의 opt-in 관측 창 표시.
- **A1/B/A2 실측 결과는 아니다.** 제품 기본 간격은 1,000ms이며 이번 작업에서 실행 중 API를 재시작하거나 AWS를 사용하지 않았다.

## 구현

`OutboxScheduler`는 DEBUG일 때만 `outbox.poll.completed`를 기록한다. `publishedCount`는 기존 Publisher 반환값이고 실패 시 생략한다. 단조 ticker로 잰 `durationMs`가 역행하거나 관측 시계가 실패하면 수치를 만들지 않는다. INFO에서는 추가 ticker·필드 구성을 건너뛴다. 기존 발행 시각 인자와 예외 전파·Scheduler 기본값·Outbox 조회·배치 정책은 유지한다.

`scripts/outbox-delay-observation.mjs`의 파싱·창 표시 생성·집계는 순수 함수다. 미발행 조회 성공/빈 반환/실패, 누락 duration, 유휴 창의 예상 외 발행을 구분한다. CPU는 창 안 표본만 사용하며 5개 미만이면 불충분이다. 같은 원본 source/line 중복, 창 누락·중복·겹침·잘못된 순서와 단조 시계 역행은 거부한다. poll duration의 Java 지수 표기(`1.0E-6`)도 받지만 NaN·음수·빈 숫자를 받지 않는다.

`scripts/collect-outbox-delay.mjs`는 합쳐진 live 표준 입력에서 인식된 관측만 받는다. 수신 직후 자신의 단조 시각과 원본 줄 번호를 붙이고, 정제한 원본·유휴/입찰 창 요약을 JSON으로 저장한다. EOF나 인식된 잘못된 입력에서는 미완료/무효 결과를 남긴다. 강제 종료·디스크 오류까지 파일 보존을 보장하지는 않는다.

- label은 A1/B/A2만 허용한다. 실제 서버 간격과 label 일치는 실행자가 별도로 확인해야 한다.
- 출력은 저장소 밖의 새 파일만 허용하며 기존 파일·symlink 파일을 덮어쓰지 않는다. 부모 경로 symlink도 해석해 저장소 안 출력은 거부한다. 파일 권한은 0600이다.
- 순서는 `idle open → idle close → bid open → bid close`다. unrelated 출력은 버리고, 허용하지 않은 원문 필드는 저장하지 않는다.
- `valid`는 **poll 관측 창의 유효성**뿐이다. `costComparisonReady`는 여기에 CPU 표본 수를 추가한 조건이다. 어느 것도 브라우저 2초 기준·원장 정합성·실험 전체 성공 판정이 아니다. 실측에서는 브라우저 결과 및 SQL/eventId 연결 검증을 추가해야 한다.
- source/line 중복 검사는 이미 저장된 관측을 재집계할 때 적용한다. 새 stdin 줄로 다시 전송된 동일 poll이나 원본에 없는 로그 누락을 식별할 수는 없다. 비동기 전달/창 경계 오차도 기존 사양대로 보고해야 한다.

기존 지연 E2E는 `BIDFLOW_E2E_OBSERVATION=1`일 때만 첫 클릭 직전과 마지막 결과 완료/실패 종료에 bid 창 표시를 출력한다. 성공 후 P95 단언이 실패해도 close는 한 번만 남긴다. 요청별 타이머·기본 polling·보조 polling·2초 임계값은 바꾸지 않았다. 프로세스 강제 종료나 창 열기 전 준비 실패는 불완전한 입력으로 남는다.

## 입력 연결 방법

저장소 루트에서 수집기를 실행한다. 아래 stdin은 **API·CPU·창 표시를 동시에 수집하며 live로 합치는 실행자**가 전달해야 한다. 저장된 로그 파일을 사후에 이어 붙여 입력하면 원래 시간 간격이 사라지므로 성능 증적이 아니다. 이 CLI는 서버 재시작·워밍업·60초 대기·프로필 복원·SQL 정합성 조회를 자동 수행하지 않는다.

```sh
node scripts/collect-outbox-delay.mjs A1 /tmp/new-outbox-A1.json
```

받는 입력은 다음 세 종류다.

1. API JSON 로그: `OutboxScheduler`의 poll 로그와 기존 `OutboxTimingLog`. 이벤트 로그는 허용 필드만 남기며 requestId/eventId 연결은 사후 SQL로 수행한다.
2. CPU JSON: 아래처럼 컨테이너 한 개의 CPU 표본을 live 전달한다. 실제 수신 간격은 저장된 상대 시각에서 확인한다.
3. 창 표시: `{"bidflowObservation":"window","window":"idle","edge":"open"}` / `close`. bid 창은 기존 E2E가 플래그 활성 시 출력한다.

```sh
docker stats --format '{"bidflowObservation":"cpu","container":"{{.Name}}","cpu":"{{.CPUPerc}}"}' \
  bidflow-local-postgres-1

# apps/web에서, 실행 중인 local,e2e API/Vite와 수집 연결을 준비한 뒤
BIDFLOW_E2E_BASE_URL=http://127.0.0.1:5173 BIDFLOW_E2E_LATENCY=1 BIDFLOW_E2E_OBSERVATION=1 \
  npx --yes node@24 ./node_modules/@playwright/test/cli.js test \
  --workers=1 --reporter=list --output=/tmp/new-outbox-browser-A1 --grep '순차 입찰 20건'
```

위 개별 명령만 실행했다고 API·CPU·E2E 입력이 자동으로 합쳐지지는 않는다. 다음 실측 회차에서 같은 수집기 stdin에 세 스트림을 전달하고 EOF로 종료한다. 출력 label·실행 인자·버전·commit을 실측 보고서에 함께 남긴다. 기본 P95 단언의 exit code 1과 수집 자체 실패도 분리한다.

## TDD·검증

먼저 Scheduler/집계 테스트를 추가해 미구현 생성자와 모듈 부재로 RED를 확인했다. CLI의 미완료 증적·Java 지수 표기·이벤트 정제 테스트도 실패를 확인한 후 구현했다.

```sh
./backend/gradlew -p backend :runtime:test --tests '*OutboxSchedulerTest' --tests '*OutboxTimingTest'
./backend/gradlew -p backend check :runtime:bootJar
node --test tests/scripts/outbox-delay-observation.test.mjs tests/scripts/collect-outbox-delay.test.mjs \
  tests/scripts/browser-result-latency.test.mjs tests/scripts/final-settlement.test.mjs \
  tests/scripts/measure-final-settlement.test.mjs
```

Scheduler 6개·기존 Outbox 로그 3개, Node 19개가 통과했다. 백엔드 전체 check·bootJar도 통과했다. 프런트 TypeScript build 검사·상태/컴포넌트 테스트 68개(17개 파일)와 Playwright `--list`의 6개 테스트 로딩을 확인했다. 실제 서비스에 연결한 지연 E2E·유휴 60초·CPU 수집·A1/B/A2 비교는 실행하지 않았으므로 개선 수치나 2초 달성을 주장하지 않는다.

## 다음 작업

후속 [A1/B/A2 실측 보고](issue-019-outbox-delay-aba.md)에서 병합한 같은 commit으로 워밍업·비교를 진행했다. 수치와 무결성·비용 한계를 보고한 뒤 설정 채택 여부를 판단한다. #19/#18은 열린 상태를 유지한다. 이 구현 회차에서는 실행 중 기본 local 서버를 재시작하지 않았고 health 200을 확인했다. 전체 백엔드 검증에는 기존 로컬 서비스 통합 테스트가 포함되지만, 기존 데이터 삭제·볼륨 초기화·루트 package-lock.json 변경은 하지 않았다.
