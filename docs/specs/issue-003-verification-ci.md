# [Issue #3] 공통 검증 명령과 CI 사양

- 상태: #274 승인 및 #275 구현 병합 완료. 로컬·PR·main push의 공통 검증 성공. [검증 결과](../reports/issue-003-verification-ci.md)에서 실행 범위를 확인한다.
- 기존 이슈: [#3 개발 기반](https://github.com/dev-baek/bidflow/issues/3). [원래 부트스트랩 사양](issue-003-repository-bootstrap.md)의 I.4/I.6과 남은 완료 조건을 구체화한다.
- 후속 제안: [#20 통합 검증 완전성](issue-020-integration-completeness.md). 실제 skip 사례 뒤 `verify-integration`의 엄격 판정·실행 누락 차단을 구체화한다. 승인 전에는 기존 명령 계약을 변경하지 않는다.

## S. 검증 사용 흐름

개발자는 Java 21·Node 24와 의존성을 준비한 뒤 `make verify` 하나로 기본 검증을 실행한다. PR과 main에서도 같은 명령을 사용한다. 기본 검증은 Docker·로컬 API·AWS 자격증명을 요구하지 않는다. 실제 Protocol·서비스·브라우저 검증은 별도 명령/절차로 유지한다.

사용자 화면이나 입찰 동작은 바꾸지 않는다. 기본 CI가 녹색인 것과 통합/E2E/AWS 검증 완료를 구분한다.

## D. 테스트 데이터와 자격증명

기존 DB·Redis·Kafka·OpenSearch·객체 스토리지에 기본 검증이 접속하거나 데이터를 쓰지 않아야 한다. Docker Compose 시작/종료·volume reset·offset reset·AWS 리소스 명령을 일반 검증에 포함하지 않는다.

lock file은 `apps/web/package-lock.json`을 사용한다. 기존 루트 미추적 package-lock.json은 추가/수정하지 않는다. `.env`·tfvars·state·AWS credentials를 읽거나 로그/캐시에 담지 않는다. Gradle/Maven/npm 의존성 다운로드는 필요할 수 있으며 이를 외부 서비스 통합 검증과 혼동하지 않는다.

## B. 백엔드 테스트 분리

새 `unitTest` Test task를 각 Java 모듈에 정의하고 root aggregate로 모은다. 기존 test source set/classpath를 재사용하며 `integration` JUnit tag를 제외한다. Testcontainers·실제 외부 서비스·전체 Spring Boot 자동구성이 필요한 테스트에는 클래스 단위 `@Tag("integration")`을 명시한다. 직접 표식 검색으로 현재 16개 후보를 확인했지만 구현 시 전체 테스트의 I/O를 점검해 최종 목록과 실행 수를 보고한다.

분류 기준은 이름에 `IntegrationTest`가 있는지 여부만이 아니다. 예를 들어 `ReadinessEndpointTest`도 전체 Spring context를 열어 로컬 의존 서비스가 필요하므로 통합 범위다. 외부 서비스가 없는 작은 config context, fake Port, 테스트가 소유한 격리된 stub은 기본 범위에 둘 수 있다.

**기존 `test`/`check`에는 tag 제외를 걸지 않는다.** 전체 검증의 의미와 기존 명령을 보존한다. Docker가 없어서 통합 테스트가 skip된 것을 unit 검증 성공이나 실제 통합 성공으로 세지 않는다. unit report는 기존 전체 test report와 별도 경로를 사용한다. 포함/제외 목록과 실행·실패·skip 수를 확인해 빈 테스트 집합의 녹색도 방지한다. [Gradle JUnit tag 필터](https://docs.gradle.org/current/userguide/java_testing.html#test_filtering)

## I. 명령 계약

아래 명령을 구현한다. 기존 local-up/down/reset·부하·장애 명령은 유지한다.

| 명령 | 범위 |
|---|---|
| make help | 지원 명령·필요 도구·Docker/서비스 필요 여부 안내 |
| make setup | Java/Node/npm 최소 사전 조건 확인, apps/web npm ci, Gradle Wrapper 확인. 도구를 자동 설치하지 않음 |
| make test-backend | root unitTest와 모듈 의존 규칙 검증. 모든 모듈의 외부 서비스 없는 테스트 포함 |
| make test-web | 기존 Vitest run |
| make test-scripts | 외부 서비스 없이 실행되는 tests/scripts/*.test.mjs와 공통 명령 자체의 fixture 테스트 |
| make test | backend → web → scripts 순차 실행 |
| make build | bootJar → TypeScript/Vite production build. 배포 없음 |
| make verify | 도구 확인 → 정적 검사 → test → build 순서. 실패 시 후속 단계 중단 |
| make verify-integration | Docker/기존 로컬 서비스 사전 확인 후 기존 backend check 전체 실행. 서비스 자동 시작/정리 없음 |

최소 사전 조건은 Java 21·Node 24·npm·Git·Make와 필요한 설치 산출물이다. 기존 전체 `check-prerequisites.sh`는 Docker/Terraform/AWS CLI까지 검사하므로 기본 검증에 그대로 호출하지 않는다. 지원하지 않는 버전은 원인과 준비 방법을 알리고 실패한다. 네트워크·캐시 오류도 설치 성공으로 숨기지 않는다.

정적 검사는 모듈 의존 규칙과 `git diff --check` whitespace 검사를 사용한다. TypeScript 검사는 build 단계에 포함한다. 기존 원래 사양의 Format 단계는 이번 범위에서 **변경 내용의 whitespace 검사**로 한정하며, 저장소 전체가 formatter로 정렬됐다고 주장하지 않는다. 새 formatter·lint dependency 도입이나 일괄 포맷 변경은 하지 않는다.

`verify`/`test`는 `make -j`에서도 상위 단계 순서를 지키도록 구성한다. 하위 명령이 실패하면 원래 실패 코드/단계를 로그에 남기고 전체 명령도 nonzero다. Make 자체가 외부 종료 코드를 2로 반환할 수 있으므로, 하위 도구의 숫자 코드가 최상위까지 동일하다고 보장하지 않는다. 성공 echo·`|| true` 등으로 실패를 삼키지 않는다.

`verify-integration`은 기본 네 가지 로컬 서비스의 health와 Docker 동작을 확인한다. Testcontainers가 만드는 전용 컨테이너 외에는 새 서비스를 생성하지 않는다. OpenSearch/브라우저 E2E·Terraform 계약 검사·AWS 검증은 이 target의 성공에도 포함됐다고 표시하지 않고 기존 별도 절차로 안내한다.

## I. GitHub Actions

`.github/workflows/ci.yml`을 `pull_request`와 `main` push에 실행한다. GitHub-hosted Ubuntu runner, Java 21·Node 24, frontend lock file 기준 npm ci, 의존성 캐시를 사용한 뒤 **로컬과 같은 make verify**를 호출한다. job 상한은 20분이다. 같은 PR/branch의 오래된 실행은 concurrency 취소로 제한한다.

- 권한은 `contents: read`, checkout credentials 보존은 끈다. id-token/write·AWS credential action·repository/environment secrets 참조는 넣지 않는다.
- `pull_request_target`이나 PR 제목/본문을 shell에 직접 삽입하는 구성을 쓰지 않는다.
- 공식 checkout/setup-java/setup-node만 사용하고 구현 시 공식 저장소에서 검증한 전체 commit SHA로 고정한다. 새 workflow framework·배포 job은 도입하지 않는다. [GitHub 보안 지침](https://docs.github.com/en/actions/reference/security/secure-use)
- `make verify`가 통과하면 GitHub runner에서만 합성 데이터 기반 [브라우저 스모크 테스트](../reports/issue-376-marketplace-ui-regression.md)를 추가로 실행한다. 실패 증적은 업로드하지 않는다.
- 실제 인프라를 연결한 브라우저 E2E는 실행하지 않으며 Terraform·CloudWatch·배포도 시작하지 않는다. GitHub Actions 사용량과 실제 AWS 사용은 별개다.
- 캐시는 dependency 범위에 한정한다. 실제 비밀 파일·state·전체 작업 디렉터리는 포함하지 않는다. 이번 범위에서는 trace/전체 로그 artifact 업로드도 추가하지 않는다.

## T. TDD와 검증 증적

1. Make target 부재를 RED로 확인한다. 외부 명령을 stub으로 대체하는 테스트로 단계 순서·첫 실패 후 중단·도구 버전 거부·Docker/AWS 미호출을 검증한다. macOS 기본 Make와 POSIX shell에서 동작하는 범위를 유지한다.
2. 백엔드 unitTest task와 명시적 통합 tag 분류를 추가한다. 작은 테스트 집합만 골라 통과시키지 않고 모든 모듈의 실제 unit 결과/통합 제외 목록을 확인한다. 기존 check에 제외 규칙이 없음을 검증한다.
3. 로컬 `make verify`를 Java 21/Node 24로 실행한다. 실패/skip·캐시 재사용을 구분하며, 실행 중 Docker를 중단하거나 실제 AWS 계정을 제공해서 성공시키지 않는다. 외부 연결을 막은 unit 실행과 report의 제외 목록도 확인한다.
4. 가능하면 기존 전체 backend check도 별도 실행해 tag 추가가 전체 테스트를 없애지 않았는지 확인한다. 그 결과는 단위 CI와 분리한다.
5. workflow의 event·권한·버전·SHA·호출 명령을 계약 테스트로 확인하고 PR의 실제 GitHub Actions 결과를 조회한다. 정적 검사나 로컬 성공만으로 원격 CI 성공을 주장하지 않는다. Actions 비활성화·권한/승인 필요·미실행·runner 오류는 그대로 보고한다.

이 문서 병합은 후속 설정/스크립트/테스트/workflow 구현을 승인하는 단계다. 기존 #3은 실제 로컬·원격 공통 검증 증적을 확인하기 전 완료 처리하지 않는다. branch protection이나 저장소 권한을 임의로 바꾸지 않는다.
