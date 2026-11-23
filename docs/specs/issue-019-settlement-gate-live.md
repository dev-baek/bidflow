# 완료 확인을 적용한 정산 조회 실측 계획

- 상태: #315 병합 승인 후 10건 smoke 통과 및 별도 경매의 누적 1,000건 본 실행 1회. 완료 확인 후 정산 SQL을 한 번 호출했으나 시간 초과로 전체 미통과. [실측 결과](../reports/issue-019-settlement-gate-live.md). 기존 [#19](https://github.com/dev-baek/bidflow/issues/19)의 범위다.
- 기반: [#314 준비 확인 구현](issue-019-settlement-snapshot-gate.md), [#312 실패 결과](../reports/issue-019-ingress-full-verification.md), [동일 실행 검증 계획](issue-019-ingress-full-verification.md).

#312에서는 1,000건의 응답과 계측이 연결됐지만 정산 SQL이 4초에 취소됐다. #314는 전체 SQL을 변경하지 않고 호출 시점을 늦춘다. 새 실행에서 **실제로 Kafka 적체 0과 요청 완료 수를 확인한 뒤 정산 SQL을 한 번 호출하고, 기존 원장·화면·계측 판정까지 끝나는지** 확인한다. 이번 결과로 과거 시간 초과의 원인이나 해결을 소급 확정하지 않는다.

## S. 같은 경매의 사용자 관측

기존 Chromium 관측자 A/B를 유지한다. 다른 context에서 같은 경매의 공개 이벤트를 받아 새로고침 없이 smoke의 510,000원과 본 실행의 50,010,000원을 확인한다. 해당 화면의 마지막 frame과 확인 기록은 SQL 최종 승인 이벤트와 일치해야 한다. 화면 기록만 남으면 부분 관측이다.

## D. 준비 확인의 증거

단계별로 새 경매·runId·보호된 출력 경로를 사용한다. 명령 추적과 관측 시각으로 아래 순서를 대조한다.

1. 부하 종료 후 세 파티션의 새 Lag가 모두 0으로 관측된다.
2. 해당 경매의 `SETTLEMENT_READINESS`와 `readinessChecks`에서 계획한 전체 요청 수와 완료 수가 일치한다.
3. 그 뒤 정산 `SCOPED_SQL`이 정확히 한 번 호출된다. 부하 시작 전 Fixture 생성용 `SCOPED_SQL`은 별도로 구분한다.
4. SQL 결과의 요청·원장·결과와 A/B frame·DOM을 대조하고, 후속 Lag 0·DLT 불변을 확인한다.

준비 이전 SQL 실행, 재호출, 순서 증거 누락, 다른 경매 자료는 승인 기준 미달이다. 미완료 또는 마감으로 SQL을 호출하지 못하면 0회와 그 사유를 기록한다. Lag 0과 완료 수는 전체 정합성을 대신하지 않는다.

## B. 실행기와 결과 해석

기존 브라우저 모드와 `runtime.apiMode=INGRESS_TIMING`을 유지한다. `joinBidIngress`는 원래 receipts 전체를 해당 JVM의 접수·계측 로그와 연결한다. 누락·중복을 지우지 않는다. 기존 실행기 판정(`valid`, `fullVerified`), 준비/호출 순서, 요청별 계측 연결을 서로 분리해 기록한다.

보고서에 마지막 Lag, 준비 완료까지의 관측 시간, 정산 조회 횟수·경과, SQL·브라우저·DLT 결과와 복원을 남긴다. 명령 시각과 브라우저는 실행기 단조 시계를 사용하고, 다른 시계나 서로 다른 백분위는 빼지 않는다. 원본은 외부 보호 경로에 두며 커밋에는 허용 필드만 남긴다.

## I. 기존 제한과 복원

[기존 실행 계약](issue-019-ingress-full-verification.md#i-로컬-실행과-복원)을 따른다. 승인 main의 깨끗한 worktree에서 `make verify`·Node 24·Java 21·로컬 Docker/k6/Chromium·readiness와 기존 PID/소유권/jar hash/인자를 확인한다. 다른 부하나 포트 점유가 있으면 시작하지 않는다. 검증 중에만 local/system Clock/100ms/INFO/계측 opt-in의 loopback API와 로컬 Vite를 사용한다.

4초 statement·5초 프로세스, 회복 60초 등 기존 한계는 그대로다. 실패 시에도 소유 검증 프로세스만 정리하고 원래 API의 인자·jar·listen·readiness를 복원한다. 기존 데이터·볼륨·Redis key·Kafka offset, DB 설정, 스키마, 인덱스는 변경하지 않는다.

## T. 이번에 허용할 단계

| 단계 | 횟수와 통과 조건 |
|---|---|
| smoke | 새 경매 10건(2 VU × 5회), 최대 1회. 기존 smoke·SQL/화면·계측 10/10, 준비 확인 뒤 전체 조회 1회 및 단계 정리가 모두 통과해야 다음 단계로 간다. |
| 본 실행 | smoke 통과 뒤 별도 경매의 누적 1,000건(20 VU × 50회), 최대 1회. 기존 P95 < 300ms·오류율 < 1%, SQL·화면·자원·Lag/DLT·계측 1,000/1,000, 준비/호출 순서, API 복원이 모두 필요하다. |

smoke 실패면 본 실행을 시작하지 않는다. 본 실행 실패 뒤에도 자동 재시도, 임계값 완화, 사후 DB 조회, 장애 주입은 하지 않는다. #302/#306/#312 판정은 유지한다. AWS와 1,000건 전체 동시 HTTP는 범위 밖이다.
