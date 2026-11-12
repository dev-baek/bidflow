# [Issue #32] 로컬 데이터 서비스 검증 보고서

- 작업 완료일: 2026-11-12
- Issue: [#32 Kafka·Redis·OpenSearch 로컬 Docker 환경 구성](https://github.com/dev-baek/bidflow/issues/32)
- 구현계획: [`2026-07-29-local-infrastructure-bootstrap.md`](../superpowers/plans/2026-07-29-local-infrastructure-bootstrap.md)
- 브랜치: `feature/issue-32-local-services`

## 1. 구현 결과

- Apple Silicon에서 PostgreSQL·Kafka·Redis를 하나의 Docker Compose 명령으로 실행한다.
- OpenSearch는 메모리 비용을 줄이기 위해 `search` 프로필에서만 실행한다.
- 모든 호스트 포트는 `127.0.0.1`에만 공개한다.
- 서비스별 Health Check와 전체 준비 상태 검사 스크립트를 제공한다.
- `local-down`은 데이터를 보존하고, 명시적으로 확인한 `local-reset`만 BidFlow 볼륨을 삭제한다.
- 로컬 환경은 AWS CLI와 AWS 자격증명 없이 실행된다.

## 2. 로컬 우선 개발 결정

비용을 발생시키는 AWS 환경보다 MacBook의 실제 프로토콜 구현을 먼저 검증한다.

```text
MacBook Docker 검증
→ 로컬 통합·E2E·장애 테스트 통과
→ AWS 마이그레이션 판단
→ PostgreSQL: RDS
→ Kafka: MSK
→ Redis: ElastiCache
→ OpenSearch: AWS OpenSearch
```

Domain과 Application은 로컬 또는 AWS 제품에 의존하지 않는다. Adapter의 접속 주소, 인증과 인프라 설정만 교체할 수 있도록 유지한다. Terraform과 AWS 배포 이슈는 로컬 검증 기준을 통과한 뒤 진행한다.

## 3. RED 증적

| 대상 | 확인한 실패 |
|---|---|
| 사전 조건 검사 | 구현 스크립트 부재로 테스트 실패 |
| 서비스 Health 검사 | 구현 스크립트 부재로 테스트 실패 |
| 안전한 초기화 | 구현 스크립트 부재로 테스트 실패 |
| PostgreSQL 최초 실행 | Homebrew PostgreSQL 18이 호스트 `5432`를 사용해 Bind 실패 |
| OpenSearch 최초 실행 | Docker 진입 스크립트가 데모 보안 관리자 비밀번호를 요구하며 종료 |

기존 Homebrew PostgreSQL을 중단하지 않고 BidFlow 호스트 포트를 `15432`로 분리했다. OpenSearch는 루프백에만 공개되는 로컬 환경에서 `DISABLE_SECURITY_PLUGIN=true`를 사용하도록 수정했다.

## 4. GREEN 증적

다음 검증이 통과했다.

- 사전 조건 검사 Shell Test
- 서비스 Health 검사 Shell Test
- 안전한 초기화 Shell Test
- 기본 Compose와 `search` 프로필 Config 검증
- PostgreSQL·Kafka·Redis·OpenSearch ARM64 Manifest 확인
- PostgreSQL `pg_isready`: `accepting connections`
- Kafka Topic 조회 명령: 종료 코드 `0`
- Redis `PING`: `PONG`
- OpenSearch Cluster Health: `green`
- 네 컨테이너의 Docker Health: `healthy`

## 5. 실행 환경과 포트

| 항목 | 값 |
|---|---|
| CPU Architecture | `arm64` |
| Docker | `27.5.1` |
| Docker Compose | `v2.32.4-desktop.1` |
| PostgreSQL | `127.0.0.1:15432` → Container `5432` |
| Kafka | `127.0.0.1:9092` |
| Redis | `127.0.0.1:6379` |
| OpenSearch | `127.0.0.1:9200`, 선택 프로필 |

다운로드된 이미지의 합계는 약 1.12 GB이며 OpenSearch가 약 776 MB로 가장 크다. 실행하지 않을 때는 `make local-down`으로 메모리 사용을 없앨 수 있다.

## 6. 데이터 보존과 삭제 검증

1. 확인 문자열 없이 `make local-reset`을 실행하면 종료 코드 `2`로 차단됐다.
2. 차단 후 네 서비스가 계속 실행 중임을 확인했다.
3. `make local-down` 후 네 Named Volume이 모두 남아 있었다.
4. `CONFIRM_BIDFLOW_RESET=bidflow-local make local-reset` 실행 후 BidFlow 볼륨만 제거됐다.
5. 다른 Docker 리소스와 Homebrew PostgreSQL은 변경하지 않았다.

최종 로컬 상태는 컨테이너·네트워크·BidFlow 데이터 볼륨이 제거되고, 재사용할 고정 버전 이미지만 남아 있는 상태다.

## 7. 완료 조건

- [x] Apple Silicon 지원 고정 이미지 사용
- [x] 기본 서비스와 선택적 OpenSearch 프로필 분리
- [x] 루프백 포트 바인딩
- [x] 실제 프로토콜 및 Health Check 검증
- [x] `local-down` 데이터 보존 확인
- [x] 확인 문자열 없는 초기화 차단
- [x] BidFlow 범위의 명시적 데이터 초기화 확인
- [x] 로컬 검증 후 AWS로 이전하는 순서 기록
