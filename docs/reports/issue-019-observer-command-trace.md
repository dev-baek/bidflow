# 관측 명령 추적 구현과 읽기 전용 검증

[#289 승인 사양](../specs/issue-019-observer-command-trace.md)에 따라 명령별 추적과 HTTP 구간 요약을 기존 collector에 연결했다. 커밋 후 실제 읽기 전용 실행에서 **관측 호출 18개와 준비/확인 10개, 총 28개 명령이 28개 trace와 일치**했다. 이는 계측 검증이며 새 입찰·smoke·1,000건 성공을 의미하지 않는다.

## 구현과 유지한 계약

scripts/command-trace.mjs의 순수 summarizeTrace/summarizePhases와 얇은 createCommandTrace 실행 경계를 사용한다. 기존 run-focused-load의 execFile 호출마다 고정 operation과 commandId, 같은 performance 시계의 시작/완료·소요·실제 timeout, 허용된 결과/종료 코드/signal을 기록한다. 프로그램·argv·SQL·stdout/stderr·환경·예외 메시지는 저장하지 않는다. k6 장기 실행 spawn과 HTTP readiness는 이 execFile trace가 아니라 기존 실행/상태 확인 계약을 유지한다.

원래 명령의 결과 또는 오류 객체를 그대로 전달하고 재시도하지 않는다. 기존 명령별 5초/12초(정리 명령 10초)와 출력 4,000,000바이트 제한도 유지했다. 실제 실행기는 자신의 deadline 타이머가 로컬 자식 프로세스에 SIGTERM을 요청한 경우와 그 외 종료를 구분한다. killed=true만으로 timeout을 확정하지 않는다. 출력 제한은 OUTPUT_LIMIT, 명확하지 않은 종료는 TERMINATED로 남긴다. 이것이 Docker 내부 작업까지 정확히 언제 끝났는지를 보장하는 것은 아니다.

명령은 시작 순서로 ID를 부여하며 나중 명령이 먼저 끝나도 완료를 해당 ID에 연결한다. 미완료·중복/누락 ID·시계 역전·잘못된 값은 완전한 trace가 아니다. snapshot은 복사본으로 반환한다. 512개가 넘으면 처음 기록을 유지하고 truncated를 표시한다. 정리 명령을 막지 않도록 이후 명령 실행은 유지하지만 전체 검증 성공으로 세지 않는다.

commandTrace.complete는 기록의 완전성이고 successful은 명령이 모두 성공했다는 별도 값이다. phaseSummary.complete는 blocked/connecting/sending/waiting/receiving의 숫자 요약이 모두 확인됐는지다. collector는 부분 기록 저장 전과 상태 확인 후 trace를 받아 정리 과정까지 포함한다. 진단 누락/잘림/실패가 있으면 SQL이 맞아도 observationValid/valid/fullVerified를 성공으로 만들지 않는다.

기존 duration P95 판정과 가격/원장/SQL·API·DB schema·의존성·부하/회복 상한·샘플 간격은 그대로다. phaseSummary는 기존 k6 summary의 med/p(95)/p(99)를 보존할 뿐 백분위를 더하거나 빼서 새 지연을 만들지 않는다. 누락·음수·NaN·Infinity는 null/미확인으로 남기며 과거 증적은 변경하지 않았다.

## TDD와 기본 검증

최소 미구현 상태에서 새 추적 테스트 7개 중 6개가 실패했다. 성공 반환/원래 오류/호출 한 번, 명시적 deadline 표시와 강제 종료 구분, 동시 완료 역전, 512개 이후 정리 유지, HTTP 요약을 구현한 뒤 통과했다. 이후 허용 필드 안의 비밀 문자열이 남는 RED와 필드 누락을 정상으로 세는 RED도 확인하고 sanitizer/완전성 검사를 보완했다.

collector 연결 전에는 진단 필드 부재·미확인 trace 허용·상태 확인 후 trace 갱신 부재 등의 테스트 4개가 실패했다. 연결 후에는 SQL·기존 HTTP 성능이 정상이어도 진단이 없으면 실패하고, 성능 기준 초과와 진단 실패를 구분하며, 쓰기/정리/상태 확인의 기존 오류 처리를 유지한다. Node 자식 프로세스로 stdout 성공·exit 7·실제 출력 제한·deadline 종료도 별도로 확인했다. 비밀 문자열이 trace에 들어가지 않는 것을 검증했다.

신규 Node 테스트는 11개다. Java 21/Node 24의 make verify에서 Node 92개·Vitest 17파일/71개·TypeScript/Vite build가 통과했다. backend unitTest와 bootJar는 UP-TO-DATE 결과를 재사용했다. 새 실행 코드는 읽기 전용 실측 전에 `9523a0c`로 커밋했다.

## 실제 계측 검증

2026년 11월 22일 02:30:12–02:30:32 UTC에 기존 로컬 서비스로 실행했다. stats/OOM inspect/Lag를 순차 3회와 동시에 시작하는 3회로 나눠 호출했다. 별도 실행기 호출 카운터와 trace 개수를 대조했고 각 operation이 6개씩 기록됐다. 준비/상태 조회 10개를 더한 28개 모두 SUCCEEDED/exit 0, commandTrace.complete/successful=true였다. [실행 증적](evidence/issue-019-observer-command-trace.json)에 순서·시각·제한·결과를 보존했다.

| 관측 명령 | 호출 수 | 소요 범위 ms |
|---|---:|---:|
| CONTAINER_STATS | 6 | 2,020.07–2,713.34 |
| CONTAINER_OOM | 6 | 139.79–226.14 |
| KAFKA_LAG | 6 | 1,285.83–1,531.53 |

같은 계측 경계의 실제 명령 개수·완료 ID·시간/소요를 확인한 결과다. 공유 Mac의 비무작위 소표본이며 이전 진단과 조건을 통제한 비교가 아니므로, Lag가 빨라 보인다는 이유로 계측이 성능을 개선했다고 해석하지 않는다. timeout/출력 제한은 Node 자식 프로세스 테스트에서 확인했으며 Docker 실측에서는 오류를 재현하지 않았다.

현재 API는 기존 local/명시적 1,000ms/INFO를 유지했다. PID 792·실행 인자·jar hash와 서비스 health가 전후 같았다. CLI 전체 입찰 경로를 100ms API에서 다시 실행한 결과가 아니다. 원래 기저 진단과 마찬가지로 다른 개발 컨테이너도 실행된 공유 환경이다.

또한 기존에 보존한 실패 summary의 숫자를 새 parser에 넣어 다섯 HTTP 구간을 빠짐없이 보존하는지 확인했다. historicalPhaseCheck의 원래 부하 판정은 false 그대로다. 새 HTTP 요청·새 서버 구간 시간·과거 실패의 새 원인 분석 결과를 생성한 것은 아니다.

## 남은 범위

이번 변경은 다음 실행에서 실패한 관측 명령과 결과를 구별할 기반이다. 과거 585건 중단 원인, 관측 비용과 접수 지연의 인과관계, 서버 DB/스레드 병목은 아직 미확정이다. 추가 부하 비교나 서버 내부 계측은 별도 계획을 확정한 뒤 진행한다.

AWS·브라우저·전체 backend integration·새 입찰/상품·API 재시작·서비스 중단·데이터/볼륨/offset 변경은 없었다. 원본 미추적 파일도 보존했다. #19와 1,000건 검증은 미완료로 유지한다.
