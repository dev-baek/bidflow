# 백엔드 전체 테스트와 Docker 소켓 진단 결과

기존 [공통 검증 사양](../specs/issue-003-verification-ci.md)의 별도 전체 백엔드 검증을 #294 병합 소스에서 실행했다. **최종 57개 클래스·192개 테스트가 실패/오류/skip 0개로 통과했다.** 그중 integration 태그는 16개 클래스·46개 테스트다. [#20 로컬 기능 E2E](issue-020-local-functional-regression.md)와 별도 검증이며 이번에는 브라우저나 부하를 새로 실행하지 않았다.

첫 실행은 Gradle 성공에도 45개가 skip됐다. JUnit XML을 확인해 불완전한 실행으로 보존하고, Docker 소켓 설정을 이번 호출에만 보완한 뒤 같은 소스로 전체를 재실행했다. 앱·테스트·Gradle/Make 코드와 전역 Docker 설정은 바꾸지 않았다.

## 실행과 결과

- 소스: `a5164c71c5645fd6781d1ad798d3f0093bae3621`.
- 첫 실행: 2026년 11월 22일 06:39:47–06:40:42 UTC. 전체 192개 중 147개 실행·45개 skip, 실패/오류 0개. 통합 46개 중 45개가 skip돼 전체 통합 성공이 아니다.
- 설정 보완 뒤 실행: 같은 날 06:43:16–06:44:37 UTC (일본 시각 15:43:16–15:44:37).
- Node 24와 Java 21을 선택하고, 기존 health 스크립트로 PostgreSQL·Kafka·Redis·객체 스토리지 준비를 확인했다. `make verify-integration`의 기반 명령인 `backend/gradlew --no-daemon -p backend check --rerun-tasks`를 실행했다. make target 자체를 호출했다고 기록하지 않는다.
- `--rerun-tasks`로 기존 결과 재사용 없이 22개 Gradle task가 실제 실행됐다. JUnit XML 수정 시각이 실행 시작 이후인지도 확인했다.

| 모듈 | 테스트 클래스 | 테스트 수 | 실패 / 오류 / skip |
|---|---:|---:|---:|
| adapters | 16 | 46 | 0 / 0 / 0 |
| application | 10 | 30 | 0 / 0 / 0 |
| domain | 4 | 16 | 0 / 0 / 0 |
| event-contract | 3 | 15 | 0 / 0 / 0 |
| runtime | 24 | 85 | 0 / 0 / 0 |
| 전체 | 57 | 192 | 0 / 0 / 0 |

통합 태그 16개는 위 전체 집합의 부분집합이며 192개에 다시 더하지 않는다. PostgreSQL 마이그레이션/원장/종료·복구/멱등성, Redis 직접·자동 입찰/상태·정리, S3 호환 객체 스토리지, Redis 실시간 전달과 readiness 등을 검증했다. 실제 OpenSearch 검색·브라우저·AWS 배포는 이 명령의 성공 범위가 아니다. Kafka 관련 테스트가 포함돼도 실제 브로커 장애·부하 시나리오를 전부 재실행한 것은 아니다.

## skip 원인과 이번 호출의 보완

Docker CLI는 정상이고 Java 클라이언트도 로컬 Unix socket으로 Docker 27.5.1에 연결됐다. 그러나 별도 진단 클라이언트에서 Ryuk 시작 시 macOS 호스트의 `.docker/run/docker.sock`을 컨테이너에 bind mount하다 Docker 500/operation not supported가 발생했다. `disabledWithoutDocker=true`인 테스트는 이 준비 실패를 skip으로 처리했고 Gradle은 성공했다.

호스트에서 Docker에 접속할 소켓과 컨테이너 내부에서 사용할 소켓을 구분했다. [Testcontainers 공식 설정](https://java.testcontainers.org/features/configuration/)의 `TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE`는 Ryuk 등 Docker 동작이 필요한 컨테이너에 사용할 소켓 경로다. 이번 재검증에만 `/var/run/docker.sock`을 지정한 뒤 Ryuk와 테스트 컨테이너가 정상 시작됐고 skip이 해소됐다. Ryuk를 비활성화하거나 권한/테스트 기준을 완화하지 않았다.

이 Mac의 Docker Desktop에서 재현할 때의 예시는 다음과 같다. 다른 런타임에 그대로 적용하지 말고 로컬 Docker endpoint를 먼저 확인한다.

```sh
# Java 21·Node 24를 선택하고 기존 로컬 서비스가 healthy일 때
DOCKER_HOST="unix://${HOME}/.docker/run/docker.sock" \
TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock \
make verify-integration
```

Gradle 성공만으로 실제 통합 실행을 판단하지 않는다. `backend/*/build/test-results/test/TEST-*.xml`의 실패/오류/skip과 통합 클래스 포함 여부를 확인해야 한다. 이번 강제 재실행은 동일한 사전 점검 뒤 `check --rerun-tasks`로 수행했다. `unitTest` 보고서와 섞지 않는다. 현재 make target에 skip을 자동으로 실패시키는 새 판정기는 추가하지 않았다.

## 기존 상태 보존과 증적

기존 API PID 30982를 재시작하지 않았다. 전후 PID·정확한 인자·jar hash가 같고 readiness UP이었다. 기존 BidFlow·다른 개발 컨테이너의 ID를 모두 유지했고 사후 실행 중인 추가 테스트 컨테이너는 없었다. 테스트가 소유한 임시 컨테이너는 Testcontainers가 정리했으며 공유 데이터/볼륨/Redis key/Kafka offset을 초기화하지 않았다.

[구조화 증적](evidence/issue-020-backend-full-check.json)에 두 실행의 모듈/클래스별 수·skip·XML hash, 통합 소스 목록, 명령, 실행 시각, API/컨테이너 상태 확인을 담았다. 최초 skip을 최종 성공으로 덮어쓰지 않았다. 원문 XML의 system-out/system-err, 전체 환경·API 원문 실행 인자·Docker 인증 정보·서버 로그는 커밋하지 않았다.

최종 집계는 소스의 integration 태그 클래스 집합과 실제 XML 클래스 집합을 대조했다. 전부 최신 XML이며 빈 테스트 집합·누락 클래스·skip을 성공으로 세지 않았다. 새 비즈니스 로직이 없어 기능 TDD 변경은 없고, 기존 승인된 테스트를 실행한 결과다.

AWS 접근/배포·Cognito 실제 로그인·청구/Destroy는 하지 않았다. #20의 AWS 완료 조건과 #1의 미검증 성공 기준은 그대로 남긴다.
