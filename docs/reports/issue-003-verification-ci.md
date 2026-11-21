# 공통 검증 명령과 CI 검증 결과

2026년 11월 21일, 기존 [#3](https://github.com/dev-baek/bidflow/issues/3)의 개발 기반 작업으로 공통 Make 명령과 GitHub Actions를 구현했다. [승인 사양](../specs/issue-003-verification-ci.md)에 따라 기본 검증은 서비스 없는 단위 검증과 빌드로 제한하고, 기존 전체 통합 검증은 별도로 유지한다.

## 구현 범위

`make verify`는 도구 확인, whitespace 및 모듈 의존 규칙, 백엔드 단위 테스트, Vitest, Node 스크립트 테스트, bootJar와 TypeScript/Vite 빌드를 순서대로 실행한다. `make -j4 verify`도 이 순서를 유지한다. 최초 실패 뒤에는 다음 단계를 실행하지 않고 하위 명령의 종료 코드를 로그에 남긴다. Make 자체의 반환 코드는 하위 명령과 다를 수 있다.

`make setup`은 Java 21·Node 24·npm·Git·Make를 확인한 뒤 frontend `npm ci`와 Gradle Wrapper 확인을 실행한다. 도구나 Docker 서비스를 자동 설치하지 않는다. `make help`와 개별 `test-*`, `test`, `build` 명령도 제공한다.

## TDD 결과

처음에는 `make verify` target 부재와 실행 스크립트·workflow·통합 태그 부재를 실패로 확인했다. 구현 후 fixture 기반 계약 테스트 6개가 통과했다. Java 실행 시 `JAVA_TOOL_OPTIONS` 안내 줄이 버전보다 먼저 출력되는 사례도 실패를 재현한 뒤 수정했다.

계약 테스트는 순서, 첫 실패 후 중단, 원래 실패 코드 표시, Java/Node 버전 거부, 잘못된 비교 SHA 거부, Docker/AWS 미호출, workflow 권한과 고정 SHA, 기존 전체 Test task의 필터 미변경을 확인한다. 전체 Node 스크립트 테스트는 40개 성공, 실패·skip 0개다.

## 백엔드 단위 테스트와 통합 테스트

각 모듈의 기존 test source set을 재사용하는 `unitTest`를 추가했다. 실제 Testcontainers 또는 전체 Spring Boot 자동구성이 필요한 16개 클래스에 `@Tag("integration")`을 지정했다. 이름에 IntegrationTest가 없는 ReadinessEndpointTest와 두 schema migration 테스트도 포함한다. 나머지 테스트의 I/O를 점검했으며 격리된 HTTP stub과 mock Port 기반 테스트는 단위 검증에 유지했다.

| 모듈 | unitTest | 기존 test 결과 |
|---|---:|---:|
| domain | 16 | 16 |
| application | 30 | 30 |
| event-contract | 15 | 15 |
| adapters | 2 | 92 |
| runtime | 83 | 170 |
| 합계 | 146 | 323 |

두 결과의 실패·오류·skip은 모두 0개다. XML report에서 단위 집합에 통합 16개 클래스가 없고 기존 test 집합에는 모두 있는지 확인했다. 기존 `test`/`check`의 태그 제외 규칙은 추가하지 않았다.

단위 검증은 Docker socket을 존재하지 않는 경로로, DB·Kafka·Redis·객체 스토리지·검색 endpoint를 loopback의 사용할 수 없는 port로 지정하고 AWS credential/config 경로도 없는 파일로 지정했다. 이 환경에서 `unitTest --rerun-tasks`를 실행해 146개를 캐시 재사용 없이 통과했다. 의존성 다운로드까지 차단하는 네트워크 격리 실험은 아니다.

`make verify-integration`도 Docker와 기본 로컬 서비스 health 확인 후 성공했다. 이때 변경된 adapters와 runtime의 test task는 실제 실행됐으며 domain/application/event-contract의 기존 test 결과는 UP-TO-DATE로 재사용됐다. 따라서 323개 전체를 이번에 강제 재실행했다고 해석하지 않는다. 통합 target은 서비스를 자동 시작·중지하거나 기존 데이터 볼륨을 초기화하지 않는다.

## 로컬 공통 검증

Java 21과 Node 24에서 `make verify`가 성공했다. Vitest는 17개 파일의 68개 테스트를 통과했고 backend bootJar 및 TypeScript/Vite production build도 성공했다. 최초 전체 명령의 backend unitTest는 UP-TO-DATE였으므로 위의 별도 강제 실행으로 보완했다. 스크립트 테스트는 Java 안내 줄 회귀 사례를 추가한 뒤 전체 40개를 다시 실행했다.

```bash
# Java 21의 JAVA_HOME과 Node 24의 PATH를 선택한 뒤
make setup
make verify

# Docker와 기본 로컬 서비스가 이미 실행 중일 때 별도 수행
make verify-integration
```

## GitHub Actions

PR과 main push가 동일한 `make verify`를 호출한다. Ubuntu 24.04, Java 21, Node 24를 사용하며 job 상한은 20분이다. 권한은 `contents: read`이고 checkout 자격증명을 보존하지 않는다. 공식 checkout/setup-java/setup-node를 전체 commit SHA로 고정했다. 캐시는 Gradle/npm 의존성 범위이며 secrets·AWS·배포 단계는 없다.

PR의 [Verify 실행](https://github.com/dev-baek/bidflow/actions/runs/44856131285)이 성공했다. 구현 commit은 `eaad38e9d9b43da36fae193bcfc7f38b0d88b07e`이며, GitHub-hosted runner에서 npm ci와 make verify의 실제 성공을 확인했다. 후속 문서 commit의 최신 결과는 [PR #275의 Checks](https://github.com/dev-baek/bidflow/pull/275/checks)에서 확인한다. main push 실행은 PR 병합 뒤 별도로 확인한다.

## 범위와 남은 확인

이 작업은 브라우저 E2E, k6, Terraform 계약 검사, 실제 AWS 배포를 실행하지 않았다. 기본 CI 성공은 Kafka·Redis·OpenSearch·S3의 실제 통합 성공이나 부하 SLO를 보장하지 않는다. AWS 자격증명·리소스 명령은 사용하지 않았으며 branch protection도 변경하지 않았다.

#275 병합 commit `8d452b808b7bd985b8cb20ae1e1f984053d7dfba`의 [main push 검증](https://github.com/dev-baek/bidflow/actions/runs/44856566203)도 성공했다. PR과 main에서 같은 명령이 실제 통과한 것을 확인해 기존 #3의 남은 공통 검증·CI 작업을 완료했다. 관련 없는 루트 미추적 package-lock.json은 변경·추가하지 않았다.
