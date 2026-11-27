# 통합 검증 완전성 판정 구현과 실행 결과

[#296 승인 사양](../specs/issue-020-integration-completeness.md)에 따라 `make verify-integration`이 skip·빈 집합·실행 누락·축소 필터를 성공으로 세지 않도록 수정했다. **실제 명령의 다섯 모듈 192개 테스트가 실패/skip 없이 통과했고, 엄격 판정 결과와 JUnit XML 집계가 일치했다.** 기본 `make verify`도 Node 108개·Vitest 71개와 빌드를 통과했다.

## 변경 범위와 판정 경계

`scripts/verify.sh`가 기존 Docker/서비스 health 확인 후 `check -Pbidflow.strictIntegration=true --rerun-tasks`를 호출한다. 새 Gradle 스크립트 `backend/gradle/strict-integration.gradle`는 현재 다섯 모듈의 `test`를 의존 대상으로 묶고 TestListener의 최상위 suite 결과만 수집한다. 중첩 결과를 중복 합산하거나 과거 XML을 읽어 보충하지 않는다. 완료 판정은 외부 효과 없는 결과 predicate와 얇은 수집/실행 경계로 나눴다.

엄격 모드에서는 테스트 결과의 캐시/UP-TO-DATE 재사용을 끄고, 각 모듈의 총수 > 0·성공 수 = 총수·실패/skip 0을 요구한다. 결과가 없는 태스크나 NO-SOURCE/비활성화/onlyIf/`-x`도 완료로 세지 않는다. `--tests`·include/exclude·JUnit tag 필터·ignoreFailures는 실행 전 거부한다. 부분 태스크에만 strict를 지정해 우회하는 실행도 거부한다. `STRICT_INTEGRATION_COMPLETE`는 모든 결과 확인 뒤에만 출력한다.

속성 부재/false의 기존 `check`와 `unitTest`는 유지하고 잘못된 속성 값은 실패시킨다. Gradle 8.14.3을 대상으로 검증했으며 `--tests`는 해당 버전의 별도 command-line include 집합도 확인한다. 새 파서·라이브러리·애플리케이션 모듈은 없다. 테스트 개수 192/46을 제품 판정기에 고정하지 않았다. 이 판정은 실행 완전성을 확인할 뿐 테스트 품질이나 특정 태그 존재까지 증명하지 않는다.

## RED부터 실제 Gradle fixture까지

먼저 기존 Make fixture에 엄격 속성/강제 실행의 기대값을 추가했다. 실제 호출이 기존 `gradlew -p backend check`여서 1개가 실패했다. Docker/health 실패 시 후속 호출 차단과 Gradle 실패의 단계/코드 보존도 검사한다.

새 작은 Gradle/JUnit 프로젝트에는 같은 다섯 모듈을 만들고 제품 Gradle 스크립트를 그대로 적용한다. 구현 전 빈 스크립트에서 Disabled/assumption skip·모듈 누락 등이 성공하는 RED를 확인했다. 최초 Node 집계는 15개 중 13개 실패·2개 통과였다(부모 테스트 포함). 정상 동작의 완료 표식이 없는 실패도 포함하므로 13개 모두 동일한 결함이라고 해석하지 않는다.

최소 구현 뒤 실제 Gradle로 다음을 확인했다.

- 정상 실행과 동일 입력/빌드 캐시 조건의 반복 실행 모두 다섯 개의 새 결과를 제공한다.
- Disabled·assumption abort/skip·일반 실패·빈 집합·disabled task·NO-SOURCE·onlyIf 누락은 엄격 성공이 아니다.
- 실제 Test 태스크에 전달한 `--tests`, include pattern, JUnit tag 필터, `-x`, ignoreFailures와 잘못된 속성·부분 실행을 거부한다.
- strict 부재/false에서는 기존 skip 동작을 유지하며 unitTest의 별도 실행/통합 태그 제외도 유지한다.

기본 회귀에 포함된 fixture는 Docker·AWS를 사용하지 않는다. 실제 Gradle/JUnit 실행으로 판정을 검사하므로 문자열 검사만으로 대체하지 않는다. Maven/Wrapper 의존성 준비는 필요하다. 전체 `make verify`는 Node 108개(새 부모/하위 테스트 포함)·Vitest 17파일/71개·TypeScript/Vite build를 통과했다. 백엔드 unitTest/bootJar는 UP-TO-DATE였다.

## 실제 엄격 통합 실행

- 소스: `cebd53bfc67da9c756222aca3c688e19c6887ae3`. 코드 커밋 뒤 깨끗한 작업 트리에서 `make verify-integration`을 한 번 실행했다.
- 실행: 2026년 11월 22일 07:23:22–07:24:43 UTC (일본 시각 16:23:22–16:24:43).
- Java 21/Node 24, 기존 로컬 Docker Unix socket. [#295 소켓 진단](issue-020-backend-full-check.md)에 따른 호출별 `TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock`을 사용했다. 전역 설정은 바꾸지 않고 Ryuk도 유지했다.
- Gradle 23개 task가 실제 실행됐으며 자동 재시도 없이 종료 코드 0이었다. 각 XML은 실행 시작 뒤 생성됐고 integration 태그 16개 클래스/46개 테스트의 포함도 별도로 대조했다.

| 모듈 | 엄격 결과의 성공/총수 | XML 실패/오류/skip |
|---|---:|---:|
| domain | 16 / 16 | 0 / 0 / 0 |
| application | 30 / 30 | 0 / 0 / 0 |
| event-contract | 15 / 15 | 0 / 0 / 0 |
| adapters | 46 / 46 | 0 / 0 / 0 |
| runtime | 85 / 85 | 0 / 0 / 0 |
| 전체 | 192 / 192 | 0 / 0 / 0 |

[구조화 증적](evidence/issue-020-integration-completeness.json)에 SHA·시각·실제 명령·클래스별 XML 수/hash·엄격 결과·RED/기본 검증 기록 hash와 상태 확인을 남겼다. 통합 46개는 전체 192개의 부분집합이다. 원문 stdout/stderr·환경·토큰·API argv·서버 로그는 커밋하지 않았다.

## 상태 보존과 한계

기존 API PID 30982·정확한 인자·원래 jar hash·readiness UP이 전후 같았다. API/Clock을 재시작·변경하지 않았다. 기존 개발 컨테이너 ID를 모두 유지했으며, 사후 추가 실행 컨테이너와 Testcontainers label 컨테이너는 없었다. 공유 데이터/볼륨/Redis key/Kafka offset 초기화도 없다.

#295의 첫 45개 skip과 환경 보완 기록은 그대로 보존한다. 이번 엄격 정책은 opt-in 명령의 변경이며 일반 `check`의 모든 성공이 엄격 성공으로 바뀐 것은 아니다. Gradle API/모듈 구성이 바뀌면 fixture와 계약을 함께 갱신해야 한다. 기본 CI는 여전히 Docker 없는 검증이며 이번 실제 로컬 통합 실행과 구분한다. 새 부하·브라우저·OpenSearch 실서비스·AWS 검증은 실행하지 않았고 #20의 AWS 완료 조건도 그대로 남는다.

## #405 병합 이후 로컬 재검증

2026년 11월 27일 16:09:56–16:10:53 JST, [#405](https://github.com/dev-baek/bidflow/pull/405)가 병합된 `9147c525dbe3cf40aee98aaf88850be3f2cd2b25`에서 `make verify-integration`을 한 번 실행했다. Java 21·Node 24를 사용했으며, 이 Mac에서는 앞선 Docker 소켓 보완을 이번 호출에만 적용했다.

| 모듈 | 성공 / 전체 |
|---|---:|
| domain | 16 / 16 |
| application | 33 / 33 |
| event-contract | 15 / 15 |
| adapters | 61 / 61 |
| runtime | 125 / 125 |
| 전체 | **250 / 250** |

완료 표식 `STRICT_INTEGRATION_COMPLETE`와 실행 시작 뒤 생성된 JUnit XML 66개의 결과가 일치했다. 실패·오류·skip은 각각 0개였고, `integration` 태그가 있는 16개 클래스 47개 테스트는 전체 250개에 포함된다. Gradle 태스크 23개가 실제 실행됐으며 재시도는 없었다. 기존 컨테이너 ID와 API 리스너 PID는 유지됐고, 종료 직후 남아 있던 임시 컨테이너가 정리된 뒤 컨테이너 목록이 실행 전과 같았다. API readiness도 HTTP 200이었다.

같은 커밋의 [GitHub Verify](https://github.com/dev-baek/bidflow/actions/runs/45956445065)도 합성 UI 단계까지 통과했다. GitHub의 UI 스모크와 위 로컬 백엔드 통합은 별도 실행이다. 실제 서비스 연결 브라우저 E2E·k6 부하·AWS는 이번에 다시 실행하지 않았다.
