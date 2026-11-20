# [Issue #19] 시작 시점 관측 수집기 구현

- 승인 사양: [로컬 재시작 직후 E2E 관측](../specs/issue-019-startup-observation.md)(#271).
- 범위: 기존 로그 정제·시간 순서 집계·HTTP probe·선택형 reporter·수집 CLI.
- 실제 서비스의 3회 재시작 실측은 다음 단계다. 이번 구현은 초기 시간 초과를 수정하거나 readiness/ALB 동작을 바꾸지 않는다.

## 모듈과 판정

| 파일(scripts/) | 역할 |
|---|---|
| startup-observation.mjs | 순수 파싱·식별자 정제·readiness 판정·프로세스/테스트 순서 집계 |
| probe-startup.mjs | localhost health/readiness 순차 조회, 요청 최대 1초·전체 최대 90초, 첫 readiness UP에서 반환 |
| startup-reporter.mjs | 기존 첫 두 사례의 시작/종료와 제한된 경매 ID만 출력하는 opt-in Playwright reporter |
| collect-startup-observation.mjs | live stdin 수신 단조 시각·줄 번호와 정제 결과를 외부 새 파일로 저장 |

Kafka는 기존 `KafkaMessageListenerContainer`의 알려진 할당/회수 형식을 파싱한다. group/topic whitelist, 중복 파티션, 빈 목록과 알 수 없는 형식을 구분한다. 빈/미관측 할당을 준비 완료로 계산하지 않는다. Outbox는 기존 허용 필드 파서를 재사용하고 정산 로그는 eventId/requestId/auctionId·outcome만 남긴다.

프로세스 순서는 `old.exited → api.started → readiness UP → 두 사례 → runner.exit → api.stopped → restored`다. health UP만으로 사례를 시작한 기록, 중복 source/line, 시각 역행, 잘못된 사례 순서, 누락된 종료/복원이나 사례 상태와 exit code 불일치는 수집 실패로 남긴다. **프로세스 마커는 실행자의 관측 보고**이며 CLI가 PID 소유권·OS 종료·복원 설정을 직접 검증하는 것은 아니다.

수집 JSON의 `valid`는 관측 프로토콜의 완결성이고 `summary.testsPassed`는 E2E 결과다. 정상적으로 관측된 실패 사례는 `valid=true / testsPassed=false`일 수 있다. runner exit 1을 collector 오류나 성공으로 바꾸지 않는다. skipped는 실행 성공으로 세지 않는다. SQL 검증과 전체 실험 판정은 별도다.

## HTTP와 reporter 연결

`probeStartup({emit})`는 `http://127.0.0.1:8080/actuator/health`와 `/readiness`만 조회한다. 연결 오류·timeout·잘못된 응답은 고정 코드로 정제한다. 약 200ms 간격이며 요청 시간이 실제 간격에 추가된다. health가 UP이어도 readiness가 아니면 반환하지 않고, readiness UP 뒤 별도 sleep 없이 true를 반환한다. 호출자는 즉시 E2E를 시작해야 한다. 이 helper를 기존 E2E나 배포 readiness에 자동으로 설치하지 않았다.

선택형 reporter 사용 예시(apps/web에서):

```sh
BIDFLOW_E2E_BASE_URL=http://127.0.0.1:5173 BIDFLOW_E2E_STARTUP_OBSERVATION=1 \
  npx --yes node@24 ./node_modules/@playwright/test/cli.js test \
  --workers=1 --reporter=../../scripts/startup-reporter.mjs \
  --grep '등록한 경매에 입찰이 없으면|자동 입찰로 확정된 낙찰' \
  --output=/tmp/new-startup-e2e
```

reporter는 단독으로 지정한다. list reporter를 같이 쓰면 경매 ID stdout이 중복 전달될 수 있다. 사례 2개 선택·worker 1·재시도 0을 확인하고 다른 선택이나 재시도는 setup 실패 마커로 남긴다. 오류 원문·stdout의 관계없는 문구는 출력하지 않는다. 기존 Playwright config는 바꾸지 않았다.

기존 `registerAuction`은 환경변수 `BIDFLOW_E2E_STARTUP_OBSERVATION=1`일 때만 등록 UI에서 확인한 UUID를 출력한다. 정상 실행에서는 추가 출력이 없다. UI에서 성공 ID를 읽기 전 실패하면 ID가 수집되지 않을 수 있으므로 ID 없음으로 DB 미생성을 단정하지 않는다. reporter는 chunk로 나뉜 stdout도 처리하며 알려진 경매 ID 마커만 다시 출력한다. 사례 종료 뒤 늦게 도착한 ID처럼 연결 순서가 틀린 입력은 수집 실패다.

## 수집 입력과 실행자 책임

저장소 루트에서 `node scripts/collect-startup-observation.mjs /tmp/new-startup.json`을 실행하고 **live로 합친 stdin**을 전달한다. 출력은 저장소 밖의 새 파일·0600만 허용하고 기존 파일/파일 symlink를 덮어쓰지 않는다. 부모 경로 symlink도 해석한다. EOF나 파싱/순서 오류에는 정제된 부분 증적을 남긴다. 강제 종료·디스크 오류까지 보존을 보장하지 않는다.

실행자는 아래 마커와 API/reporter 스트림을 같은 수집기에 전달한다. 마커의 공통 필드는 `startupObservation`이다.

| 종류 | 추가 필드 |
|---|---|
| old.exited / api.started / api.stopped / restored | 검증한 양의 정수 pid |
| probe | endpoint(health/readiness), httpStatus 또는 null, status 또는 null, 선택적 고정 error |
| test.begin / test.end | 고정 caseId(unsold/auto-finalization), 종료 시 status·durationMs |
| auction | UUID auctionId |
| runner.exit | 실제 자식 프로세스 code(0~255) |
| setup.failure | 고정 실패 code |

API 로그는 해당 테스트 JVM의 stdout만 전달한다. 실행자는 기존 JVM 완전 종료·최대 3회 제한·자식 timeout/종료·같은 jar/profile·사후 SQL·원래 local/명시적 1,000ms/INFO 복원을 별도로 확인해야 한다. 복원용 JVM 로그를 테스트 JVM의 로그로 합치지 않는다. 각 파일은 종료·복원까지 포함한 한 회차다. 이 CLI가 자동으로 프로세스를 재시작하거나 SQL을 실행하지 않는다.

`source=stdin`과 line은 수집기가 실제 읽은 canonical 입력의 위치다. 이미 저장된 같은 행의 중복 집계는 거부하지만, 상위 실행자가 같은 로그를 새 stdin 줄로 두 번 전달한 것을 일반적으로 구별할 수는 없다. 저장 로그를 사후 이어 붙여 전달하면 원래 수신 간격이 사라지므로 실측 증적으로 사용할 수 없다. 모든 시각은 수집 시각이고 wall clock/업무 Clock과 빼지 않는다.

## 검증 결과와 다음 단계

먼저 모듈 부재·부분 증적 미생성의 RED를 확인하고 구현했다. 신규 15개와 기존 관련 19개, 총 Node 테스트 34개가 통과했다. health/readiness 구분·요청 오류 정제·deadline·할당/회수·순서/중복·성공과 업무 실패의 CLI 완결성·경로 보호·reporter chunk/비밀값 제거를 검증했다.

실제 Playwright 엔진에서도 합성 사례 2개를 실행했다. 의도한 passed/failed 및 exit 1이 그대로 출력되고 원문 오류/비밀 fixture 문자열이 stdout/stderr에서 제거된 것을 확인했다. 이는 제품 E2E 통과나 콜드 스타트 실측이 아니다. 기존 6개 제품 테스트 로딩, TypeScript build 검사, 프런트 상태/컴포넌트 68개 테스트도 통과했다. Java 코드는 바꾸지 않아 백엔드 전체 검증을 이번에 다시 실행하지 않았다.

후속 [3회 재시작 관측](issue-019-startup-observation.md)에서 병합한 같은 commit으로 승인된 프로토콜과 SQL/eventId 연결을 검증했다. 초기 원인은 아직 미확정이다. 이 구현 회차에서는 실행 중 API·DB·볼륨·AWS를 변경하지 않았고 기존 루트 package-lock.json도 제외했다.
