# [Issue #19] 로컬 Outbox 100ms 설정 채택 사양

- 상태: 제안됨 — 승인 후 설정·테스트 구현. 이번 문서 PR에는 동작 변경이 없다.
- 기존 이슈: [#19 부하·장애 검증](https://github.com/dev-baek/bidflow/issues/19), 관측성 연관: [#18](https://github.com/dev-baek/bidflow/issues/18).
- 근거: [A1/B/A2 실측](../reports/issue-019-outbox-delay-aba.md), 선행 계약: [간격 대조 실험](issue-019-outbox-delay-experiment.md).

## S. 결정 제안과 범위

`local` 프로필의 Outbox fixed delay만 **100ms**로 채택한다. 로컬의 등록→입찰→결과 확인 피드백을 빠르게 하려는 변경이며 화면·API 계약은 그대로다.

같은 소스의 실측에서 기본 화면 관측 P95는 1,000ms의 A1/A2가 약 2.93초, 100ms의 B가 431ms였다. 대신 유휴 완료 poll이 약 1회/초에서 9.43회/초로 늘고 DB CPU 중앙값이 0.21%에서 0.985%로 증가했다. 이 절충을 **로컬 개발 환경에 한해** 수용하는 제안이다. 단일 로컬 순차 결과를 운영 환경의 비용·SLO 근거로 확대하지 않는다.

공통 fallback 1,000ms는 유지한다. `local`이 없는 인증/배포 환경에는 이번 후보를 적용하지 않는다. AWS용 프로필을 새로 만들거나 Terraform·배포 환경변수를 변경하지 않는다. `local`은 기존 로컬 인증도 활성화하므로 AWS에서 성능 설정만 얻으려고 켜서는 안 된다.

## D. 데이터와 호환성

DB migration·새 인덱스·원장/Outbox 데이터 변경은 없다. 조회 간격만 달라지며 `enqueued_at`, `occurred_at`, `published_at`의 의미는 유지한다. 이전 실측 원본·실패 증적을 새 설정의 결과로 덮어쓰지 않는다.

## B/I. 설정·복원 계약

- 기존 키 `bidflow.outbox.fixed-delay-ms`를 재사용한다. 새 설정 키·프로필·의존성·환경 자동 감지는 추가하지 않는다.
- `backend/runtime/src/main/resources/application-local.yml`에 이 키의 100ms 설정만 추가한다. 공통 `application.yml`과 Scheduler의 `${bidflow.outbox.fixed-delay-ms:1000}`는 유지한다.
- DEBUG 로그는 기본으로 켜지 않는다. 발행 순서·limit 100·실패 전파·멱등 처리·Kafka Envelope·정산 트랜잭션도 바꾸지 않는다. 고정 간격 대신 fixed rate나 적응형 backoff로 전환하지 않는다.
- 기존의 명시적 외부 property가 프로필 기본값보다 우선한다. 재시작 시 `--bidflow.outbox.fixed-delay-ms=1000`으로 이전 간격을 선택할 수 있다. 핫 리로드/런타임 관리 API는 만들지 않는다.
- 정상 로컬 시작 명령은 그대로 둔다. 구현 PR에서는 README에 로컬 100ms 적용과 1,000ms 복원 명령·추가 조회 비용을 설명한다. 문서만 읽고 이미 100ms가 적용됐다고 오인하지 않도록 승인/구현 상태를 구분한다.

| 프로필/명시적 설정 | 구현 후 기대 간격 |
|---|---:|
| 활성 프로필 없음, 별도 설정 없음 | 1,000ms |
| `local` | 100ms |
| `local,e2e` | 100ms |
| `e2e`만 활성화 | 1,000ms |
| `prod` 등 `local` 미포함 | 1,000ms |
| `local` 또는 `local,e2e` + 명시적 1,000ms | 1,000ms |

이 표는 설정 해석 계약이며 `prod`나 AWS에 실제 접속하는 테스트가 아니다. `local`을 포함하면 로컬 설정이 적용되므로 운영과 섞어 쓰지 않는다.

구현 후 로컬 실행 예시(저장소 루트, 포트 중복 없이):

```sh
# 승인·구현 이후 local 프로필 기본 100ms 사용
SPRING_PROFILES_ACTIVE=local ./backend/gradlew -p backend :runtime:bootRun

# 필요할 때만 명시적으로 1,000ms 선택
SPRING_PROFILES_ACTIVE=local ./backend/gradlew -p backend :runtime:bootRun \
  --args='--bidflow.outbox.fixed-delay-ms=1000'
```

#268 검증 종료 시 실행 중 서버에는 1,000ms CLI 인자가 명시돼 있다. 설정 파일 추가만으로 그 프로세스가 바뀌지 않는다. 구현 검증에서 서버를 재시작한다면 현재 인자·프로필을 먼저 기록하고, 검증 종료 시 원래 실행 상태로 복원하며 실제 listen PID·health를 확인한다. 현재 프로세스를 바꾸는 일과 다음 정상 시작의 프로필 기본값 변경을 구분한다.

## T. TDD와 완료 조건

1. 먼저 설정 파일이 없는 상태에서 `local`/`local,e2e`가 100ms로 해석돼야 한다는 테스트를 작성해 RED를 확인한다.
2. 문자열 검색만 하지 않고 **실제 Spring Config Data 로딩**과 Scheduler annotation의 property 해석을 사용해 위 표를 검증한다. 좁은 설정 context로 PostgreSQL·Kafka·Redis·AWS에 연결하지 않는다. 명시적 override가 우선하는 경계도 테스트한다.
3. 최소 프로필 설정을 추가해 GREEN으로 만든다. 기존 Scheduler DEBUG off·count·타이머·예외 보존 테스트의 공통 fallback 1,000ms 계약도 유지한다.
4. 백엔드 전체 check·bootJar로 로컬 프로필을 쓰는 기존 통합 테스트까지 확인한다. README의 정상 시작/복원 명령과 실제 property가 일치하는지 점검한다.
5. 가능한 로컬 `local,e2e` 환경에서는 **CLI 간격 override 없이** 기본 100ms를 읽는지 확인한 뒤 기존 기능 E2E와 순차 20건 지연 E2E를 확인한다. 판정·입력·기본 polling·2초 기준은 바꾸지 않는다. 실패하면 원본과 원인을 보고하며 profile 설정 테스트 통과로 성능 성공을 대신하지 않는다. 실행하지 못한 범위도 명시한다.

설정 채택과 새 기능 추가는 별개다. 이 작업으로 동시 부하·장기 DB 비용·장애/재발행·AWS 검증이 끝나지 않으며 #19/#18을 자동으로 닫지 않는다. 운영 기본값 변경이나 더 짧은 간격의 도입은 별도 검증·검토 대상이다.
