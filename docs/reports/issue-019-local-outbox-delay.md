# [Issue #19] 로컬 Outbox 100ms 채택 구현·검증

- 승인 사양: [로컬 프로필 100ms](../specs/issue-019-local-outbox-delay.md)(#269).
- 구현 소스: `5fbaa97` — 아래 설정·테스트·README 변경을 커밋한 뒤 E2E를 실행했다.
- 원본: [override 없는 브라우저 20건·SQL·로그·실행/복원 정보](evidence/issue-019-local-outbox-delay.json).

## 변경

`application-local.yml`에 기존 키 `bidflow.outbox.fixed-delay-ms: 100`만 추가했다. 정상 시작 명령은 유지하고 README에 비용 절충과 1,000ms 명시적 override 명령을 설명했다.

`local`/`local,e2e`만 100ms다. `local`이 없는 공통 fallback 1,000ms와 Scheduler 코드는 그대로다. 새로운 프로필·키·의존성·DB migration·인덱스·메트릭 endpoint는 없다. 발행 순서·배치·Kafka Envelope·원장·DEBUG 기본값도 바꾸지 않았다. 로컬 인증이 활성화되는 `local`을 AWS에서 성능 설정 목적으로 쓰지 않도록 안내했다.

## TDD와 설정 경계

`OutboxDelayConfigurationTest`는 실제 Config Data를 로딩하고 실제 Scheduler annotation의 placeholder를 해석한다. 문자열 검색으로 프로필 적용을 대신하지 않는다. 빈 설정 context를 사용하므로 DB·Kafka·AWS에 접속하지 않는다.

RED에서는 local 100ms 기대값이 실제 1,000ms라 실패했고 비로컬·override 사례는 통과했다. 최소 YAML 추가 후 GREEN을 확인했다. 테스트 3개 안에서 다음 7개 설정 조합을 검증한다.

| 설정 | 결과 |
|---|---:|
| 프로필 없음 / e2e만 / prod | 각각 1,000ms |
| local / local,e2e | 각각 100ms |
| local / local,e2e + CLI 1,000ms | 각각 1,000ms |

명시적 override는 `SimpleCommandLinePropertySource`를 이용한다. 프로필 설정이 DEBUG를 켜지 않는 것도 확인했다. 기존 Scheduler 테스트 6개와 함께 통과했으며 전체 backend check·bootJar도 성공했다. 패키지 안에 `application-local.yml`이 포함된 것을 확인했다.

## override 없는 로컬 E2E

Java 21 bootJar를 `local,e2e`·localhost로 시작했다. **간격과 logging CLI 인자 없이** 실행했고, 간격 환경변수와 `SPRING_APPLICATION_JSON`이 없는 것도 확인했다. 기존 Vite·Chromium·Docker 서비스를 사용했다. runtime 인자·jar hash·기준 commit은 증적에 있다.

첫 기능 실행은 2개 통과·2개 실패·2개 skip이었다. 공개 유찰의 ENDED 화면 관측이 15초 안에 완료되지 않았고, 자동입찰 시나리오의 선행 제어 입찰이 10초 안에 ACTIVE/12,000원으로 관측되지 않았다. 사후 DB에서는 각각 종료와 승인 반영이 확인됐다. 첫 실행에서는 지연/검색 플래그가 꺼져 두 사례는 건너뛰었으며 성공으로 세지 않는다.

정산·실시간 소비 그룹의 파티션 할당과 Lag 0을 확인한 뒤 **소스·timeout·단언을 바꾸지 않고 한 번만 재실행**했다. 검색·지연 플래그도 켜 기존 기능 5개와 지연 1개가 모두 실행됐고 6개 모두 통과했다.

초기 실패를 지우거나 재실행 성공으로 모든 시작 직후 동작을 보장하지 않는다. 콜드 스타트/비동기 준비 지연 가능성은 있지만 정확한 원인은 이 검증에서 확정하지 못했다. `health=UP`나 Lag 0만으로 모든 업무 전달 준비가 보장된다고 해석하지 않는다. 초기 실패 요약·경매 ID·사후 확인 결과는 증적에 보존했고 원본 trace/screenshot은 커밋하지 않았다. 시작 직후 준비 조건은 기존 #19의 후속 점검 범위로 남긴다.

## 순차 20건 결과

| 지표(ms) | P50 | P95 | P99 |
|---|---:|---:|---:|
| 기본 화면 완료 관측 | 420.12 | **430.06** | 435.16 |
| 개인 frame runner 수신 | 208.25 | 262.86 | 285.27 |
| 25ms 보조 화면 관측 | 231.88 | 298.37 | 312.69 |
| 명령 INSERT→조회 age | 42 | 89 | 101 |
| 결과 INSERT→조회 age | 100 | 103 | 104 |

20건 모두 완료·승인됐고 미완료 0개, 기존 기본 P95 2초 기준을 통과했다. 기본/보조 관측 정의와 임계값은 그대로다. 이 회차는 프로필 적용 뒤의 로컬 통합 확인이며 새 A-B-A나 동시 부하 실험이 아니다. CPU 비용을 다시 측정하지 않았으며 기존 [A-B-A 비용 증적](issue-019-outbox-delay-aba.md)을 참조한다.

SQL에서 요청·승인 요청·원장·서로 다른 원장 requestId·정산 이벤트는 각 20개, 가격 역행 0개였다. 최종 `ACTIVE / version 21 / 30,000원`과 최신 승인 이벤트의 승자·가격이 일치했다. 명령/결과 각각 20개 requestId 집합을 브라우저와 맞추고 eventId로 ack/발행 로그 80개를 연결했다. 각 이벤트의 정상 age·발행 표시를 확인했다. 실행 전체에서 poll DEBUG 로그는 관측되지 않았다.

원본에서 브라우저 요약·Outbox 백분위를 재계산해 대조했다. 업무 Clock(2030년)을 실제 지연 타이머로 쓰거나 서로 다른 구간의 백분위를 합산하지 않았다.

## 실행 상태와 남은 범위

검증 전 API는 `local / 명시적 1,000ms / INFO`였다. E2E 후 테스트 JVM이 완전히 종료된 것을 확인하고 같은 인자의 local 실행으로 복원했다. 실제 listen PID와 health 200을 확인해 증적에 남겼다. **현재 실행 상태는 1,000ms override이며, 다음 정상 local 시작의 프로필 기본값이 100ms**라는 차이가 있다.

기존 데이터 삭제·볼륨 초기화·루트 package-lock.json 변경·AWS 접근은 없었다. 프런트 컴포넌트 테스트는 이번 설정 작업에서 별도 재실행하지 않았고 브라우저 경로로 확인했다. 동시 부하·장기 비용·장애 안전성·초기 시간 초과 원인 확정·AWS 검증을 완료했다고 주장하지 않으며 #19/#18은 열린 상태다.

후속 [관측 사양](../specs/issue-019-startup-observation.md)에 따른 [3회 재시작 실측](issue-019-startup-observation.md)에서는 두 사례 모두 통과했다. 기존 초기 실패의 원인은 여전히 미확정이며 readiness나 timeout은 바꾸지 않았다.
