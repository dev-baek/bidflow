# 통합 검증의 skip과 실행 누락 차단 사양

- 상태: #296 병합으로 승인됨. TDD 구현과 실제 엄격 통합 검증을 완료했다. [구현·실행 결과](../reports/issue-020-integration-completeness.md). 아래는 승인된 계약이다.
- 기존 이슈: [#20](https://github.com/dev-baek/bidflow/issues/20). [공통 검증 계약](issue-003-verification-ci.md)의 후속이며 관련 작업이므로 새 이슈를 만들지 않는다.
- 근거: [#295 전체 백엔드 검증](../reports/issue-020-backend-full-check.md). 첫 실행은 Gradle 성공에도 192개 중 45개가 skip됐고, 호출별 Docker 소켓 보완 후 192개가 skip 없이 통과했다.

## S. 개발자에게 보이는 결과

`make verify-integration`은 단순한 Gradle 성공이 아니라 전체 백엔드 테스트가 실제 실행됐는지도 확인한다. skip·빈 집합·모듈 누락·축소 실행이면 nonzero로 끝내고 모듈/태스크와 안전한 사유·개수를 표시한다. 사용자 화면·REST·입찰 규칙은 변경하지 않는다.

기본 `make verify`/CI의 단위 테스트 범위와 Docker 불필요 계약은 유지한다. 통합 검증의 성공을 브라우저·OpenSearch 실서비스·AWS 검증 완료로 확대하지 않는다.

## D. 테스트 결과와 데이터 경계

DB 스키마/공유 데이터 변경은 없다. 판정 입력은 Gradle이 이번 실행에서 제공하는 테스트 결과와 태스크/필터 상태다. [TestResult](https://docs.gradle.org/current/javadoc/org/gradle/api/tasks/testing/TestResult.html)의 총수/성공/실패/skip 수를 활용하며, 현재 Wrapper 8.14.3에서 실제 동작을 검증한다. XML을 정규식으로 읽는 새 파서나 새 의존성을 도입하지 않는다.

기존 JUnit XML·HTML은 보존한다. 합산은 최상위 suite 결과 기준으로 한 번만 하고 중첩 suite/테스트 수를 중복 계산하지 않는다. 결과가 생성되지 않았거나 이전 실행의 결과만 있으면 현재 실행의 통과로 세지 않는다. 192개/통합 46개 같은 과거 수치를 고정 통과 조건으로 사용하지 않는다.

## B. 엄격 판정과 기존 명령 호환성

Gradle 프로젝트 속성 `bidflow.strictIntegration`을 통합 검증의 명시적 opt-in으로 사용한다. `true`일 때만 아래 엄격 규칙을 적용한다. 부재/`false`는 기존 동작을 유지하고, 다른 값은 잘못된 설정으로 실패한다. 일반 `test`/`check`나 `unitTest`에 엄격 정책을 무조건 적용하지 않는다.

엄격 모드는 다음 조건을 모두 만족해야 성공이다.

1. domain/application/event-contract/adapters/runtime의 기존 `test` 태스크가 모두 이번 호출에서 실행되고, 각 결과 집합이 비어 있지 않다.
2. 각 집합에서 실패/skip은 0이고 성공 수와 총수가 일치한다. 일반 테스트 실패의 nonzero도 그대로 유지한다. `ignoreFailures`로 우회하지 않는다.
3. 태스크가 UP-TO-DATE/FROM-CACHE/NO-SOURCE/SKIPPED 등으로 실행 결과를 제공하지 않으면 성공으로 세지 않는다. 이전 XML의 개수로 보충하지 않는다.
4. `--tests`, include/exclude pattern, JUnit tag 필터 등으로 전체 범위를 줄이면 엄격 통합 성공으로 세지 않는다. 기존 `test`의 무필터 실행과 `unitTest`의 integration 제외는 분리한다.
5. 실패·중단 뒤 일부 모듈의 결과가 누락돼도 전체 성공 요약을 출력하지 않는다. root `check`의 태스크 순서 때문에 결과가 모이기 전에 판정하지 않는다.

Gradle 결과 수집과 완전성 판정을 최소 범위로 분리한다. 새로운 애플리케이션 모듈/범용 테스트 프레임워크/임의 XML 경로 옵션은 추가하지 않는다. 현재 다섯 모듈의 실행 여부를 확인하며 모듈 구성이 바뀔 때 명시적으로 계약을 갱신한다. 비어 있지 않다는 사실만으로 모든 테스트의 품질이나 특정 태그의 존재까지 증명했다고 주장하지 않는다. 기존 통합 태그/필터 회귀 검사도 유지한다.

새 판정기가 추가하는 메시지는 모듈·태스크·총수/성공/실패/skip·실행 누락 사유로 한정한다. 환경·토큰·API 실행 인자·테스트 stdout/stderr를 새로 덤프하지 않는다. 기존 Gradle 실패 보고서는 유지한다.

## I. 실행 명령과 상태 보존

`scripts/verify.sh`의 `verify-integration`은 기존 도구/Docker/서비스 health 확인 후 전체 `check`를 엄격 속성과 `--rerun-tasks`로 호출한다. 엄격 모드 자체도 결과/빌드 캐시를 현재 실행의 대체물로 허용하지 않아, 직접 opt-in 실행에서도 같은 완전성 기준을 지킨다.

Java 21·Node 24와 기존 로컬 서비스를 사용한다. Docker 소켓 보완은 [#295 재현 절차](../reports/issue-020-backend-full-check.md)를 따르되 호출별 환경으로만 지정한다. 호스트 경로를 저장소에 하드코딩하거나 전역 설정을 변경하지 않고 Ryuk도 끄지 않는다.

기존 API의 PID·인자·jar·readiness와 개발 컨테이너를 유지한다. OS/테스트 Clock 변경, 새 입찰 부하, 서비스 중단/초기화, AWS 접근/리소스 생성은 범위 밖이다. fixture는 별도 임시 디렉터리와 테스트 소유 자원만 사용한다.

## T. TDD와 인수 기준

1. 기존 검증 명령 fixture를 확장해 엄격 속성/강제 실행 옵션 부재를 RED로 확인한다. Docker 또는 health 실패 시 Gradle 호출 전 중단, Gradle 실패 시 전체 nonzero와 원래 단계/실패 정보 보존도 확인한다.
2. Docker 없는 작은 Gradle/JUnit fixture로 정상 실행·`@Disabled`·assumption abort/skip·테스트 실패·빈 집합·모듈 결과 누락을 재현한다. 실제 skip이 기존에는 성공하는 RED를 먼저 남긴다. 문자열 구성 검사만으로 실행 판정 테스트를 대체하지 않는다.
3. 이전 성공 결과를 준비한 뒤 strict 실행에서 실제 재실행되는지, 축소 필터/잘못된 속성/NO-SOURCE 등이 성공으로 둔갑하지 않는지 검사한다. 비엄격 기본 동작과 `unitTest`는 영향을 받지 않아야 한다.
4. 최소 구현 뒤 fixture 회귀와 `make verify`/기본 CI를 확인한다. 도구 다운로드나 Gradle fixture 실행이 필요해도 기본 CI에서 Docker·AWS를 시작하지 않는다.
5. 실제 로컬 `make verify-integration`을 올바른 호출별 소켓 설정으로 한 번 실행한다. 실행 SHA·명령·각 모듈/전체 수·실패/skip·태그 포함 여부와 API/컨테이너 상태를 기록한다. 준비 실패 시 자동 반복하거나 skip을 허용해 통과시키지 않는다.

성공은 코드/명령 fixture와 실제 전체 검증이 모두 기준을 충족했을 때다. #295의 첫 45개 skip과 재검증 기록은 변경하지 않으며, 새 판정기로 과거 실행을 소급 성공 처리하지 않는다. 새 증적 PR을 별도로 검토받고 AWS가 남아 있는 #20을 자동 종료하지 않는다.
