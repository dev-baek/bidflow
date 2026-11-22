# 직접 입찰 실패의 HTTP와 메시지 및 원장 연결 결과

[#299 승인 사양](../specs/issue-020-failure-correlation.md)에 따라 직접 입찰 E2E 한 사례에 실패 진단을 연결했다. **정상 기능 5개가 통과한 뒤, 새 경매의 직접 입찰 마지막 단언 뒤에만 고정 오류를 발생시켜 HTTP 104건·WebSocket 9개·요청/원장/결과 각 3개의 연결을 확인했다.** 원래 실패는 종료 1/failed 1로 보존했고 원래 API도 복원했다.

## 구현과 보존한 계약

- `scripts/failure-correlation.mjs`: 허용 필드 추출·범위/자료형 검사, 재전송과 도메인 ID 연결, snapshot/정산 구분의 순수 판정. journal과 제한된 I/O 수집은 경계로 분리했다.
- `apps/web/e2e/failure-correlation.ts`: 기존 parser와 경매 한정 SQL 재사용, 로컬 URL/단일 사례 probe 보호, 역할별 listener·화면·JSON attachment와 안전한 수집 실패 처리.
- 기존 직접 입찰 사례에만 연결했다. 금액/키/정상 단언·API·서버 메시지·DB schema는 그대로다. 다른 기능/지연 테스트의 제출 helper는 callback 미지정 시 기존 동작을 유지한다.

Browser 응답뿐 아니라 APIRequestContext 재전송/409도 기록한다. UUID·역할·안전 정수·시각과 허용 사유를 검사하고 미지 필드를 제거한다. Authorization/Cookie·URL/query·원문 body/frame·임의 console/예외/SQL 출력은 JSON에 넣지 않는다. actor는 A/B alias로 바꾼다.

HTTP 256/WS 64/console 64건 상한과 잘림 표시, SQL 4초 statement/5초 프로세스·전체 수집 10초 예산을 유지한다. 늦은 I/O가 저장된 JSON을 바꾸지 않는다. SQL/화면/쓰기/attach/listener 해제 실패는 부분 진단으로 남기며 원래 단언 오류를 다시 던진다. context 종료 실패도 별도 annotation으로 표시하고 원래 오류를 덮지 않는다.

## TDD와 기본 검증

처음에는 모듈 부재로 RED를 확인했다. 이후 단계/예산 상한·예상 밖 HTTP 상태 보존·알려진 거절 SQL 보존을 각각 RED로 확인하고 보완했다. 마지막에는 충돌하는 중복 frame·WS 상한·역행 시계를 회귀 검사로 추가했다.

진단 단위 테스트 13개는 정상 3개 정산과 100회 replay/409, 민감 필드 제거, ID/역할/개수/가격/version/시각 변조, 누락/잘림, 유효한 최신 snapshot, 고정 사유의 부분 SQL, 등록 전 실패와 I/O/cleanup 실패·늦은 완료를 확인한다. 파일 존재만으로 연결 성공을 판정하지 않는다.

기본 `make verify`는 Node 121개·Vitest 17파일/71개와 TypeScript/Vite build를 통과했다. backend unitTest/bootJar는 UP-TO-DATE였다. 별도 E2E 타입 검사도 앱 번들의 Node 타입 정의를 사용해 통과했으며 저장소 의존성은 추가하지 않았다. 브라우저 실행 후 추가한 회귀 테스트는 제품 수집 코드/동작을 변경하지 않았다.

## 승인된 두 실행의 결과

- 실제 실행 소스: `8095a144d39c3b24af05b2780b47a16c45de7931`. 코드 커밋 후 clean tree에서 실행했다.
- 실행/복원: 2026년 11월 22일 10:50:43–10:52:28 UTC (일본 시각 19:50:43–19:52:28).
- local,e2e의 테스트 Clock·Outbox 100ms/INFO, 임시 Vite, worker 1/retry 0. 로컬 서비스 5개 healthy를 확인했고 데이터/볼륨/Redis key/Kafka offset을 초기화하지 않았다.
- 정상 5개를 한 번 실행해 passed 5·failed/skip/flaky/retry 0을 확인한 뒤, 별도 새 경매에서 probe 한 번만 실행했다. 자동 재시도는 없다.

| probe 관측 | 결과 |
|---|---|
| 원래 결과 | `BIDFLOW_EXPECTED_CORRELATION_FAILURE`, 종료 1/failed 1. 정상 단언 완료 뒤 의도한 실패 |
| HTTP | 104건: 202 접수 103건·금액 충돌 409 한 건. 고유 요청 3개, 같은 첫 요청 replay 100회 |
| WebSocket | 개인 결과 3개·공개 결과 6개. 각 요청의 도메인 eventId와 SQL 결과 ID 일치 |
| SQL | 요청/원장/결과 각 3개. A 12,000원/v2 → B 13,000원/v3 → A 14,000원/v4 |
| 최종 경매 | ACTIVE·14,000원·version 4·승자 A·마감 12:30 UTC 유지(테스트 날짜 2030-01-01) |
| 진단 상태 | invalid 0·truncated=false·correlation complete. SQL/두 화면/listener 해제 OK, reporter annotation complete |
| 파일 | 수동 역할 화면 2개·연결 JSON, Playwright 자동 화면 3개·오류 문맥·trace. 실제 attachment 대조와 ZIP 무결성 검사 완료 |

A/B 화면을 직접 열어 14,000원과 요청 처리 당시 승인 안내를 확인했다. 수동 역할별 화면과 Playwright 자동 캡처는 구분했다. 원문 screenshot/trace/reporter는 보호된 외부 디렉터리에 유지하고 커밋/업로드하지 않았다.

도메인 eventId를 STOMP message-id로 대체하지 않았다. 이 probe의 개인 메시지 snapshot은 각각 정산 version과 같았다. 더 최신인 snapshot의 허용/잘못된 가격 쌍 거부는 단위 테스트로 확인했으며, 이번 실행에서 race를 재현했다고 주장하지 않는다. 파일의 correlation complete는 연결 판정이고, attachment/cleanup 상태는 reporter와 별도로 대조했다.

## 복원과 독립 재조회

원래 PID 30982의 local/명시적 1,000ms/INFO API를 소유권·인자·jar 확인 후 완전 종료하고 검증 PID 78310을 사용했다. 종료 후 검증 JVM/Vite를 완전히 종료하고 원래 jar/인자로 PID 79499를 복원했다. jar hash·정확한 인자·listen PID·readiness UP을 확인했고 다른 개발 컨테이너 중단 명령은 실행하지 않았다. 사후 BidFlow 5개 서비스도 healthy였다.

복원 뒤 10:54:47 UTC에 probe 경매만 read-only SQL로 재조회했다. 같은 순수 판정이 complete였고 3개 연결 및 최종 상태가 수집 결과와 일치했다. 이 시각은 사후 관측이며 원래 실패 순간/정확한 DB 커밋 시간이 아니다. [구조화 증적](evidence/issue-020-failure-correlation.json)에 두 runner 결과, 허용 필드·HTTP tuple·WS/SQL 연결, artifact hash, 복원·재조회 정보를 보존했다.

## 재현과 남은 범위

기존 [#99 실행 준비](issue-099-playwright-e2e.md)의 local,e2e API/Vite와 새 보호된 외부 출력 경로를 사용한다. 정상 기능 5개가 통과한 뒤에만 `BIDFLOW_E2E_FAILURE_PROBE=direct-bid`를 지정해 직접 입찰 사례 하나를 `--grep '직접 입찰 재시도' --workers=1 --retries=0`으로 실행한다. 기본 실행에서는 probe가 꺼져 있다. 다른 사례·원격 URL·parallel/retry·잘못된 값은 거부한다. 종료 1 자체가 아니라 정확한 오류·VERIFIED 단계·연결/캡처/cleanup 상태를 모두 확인해야 한다.

이번 검증은 로컬 직접 입찰 한 사례의 실패 진단 경로이며 실제 서버 장애/운영 원인 분석이나 새 부하/성능 측정이 아니다. 다른 E2E 사례의 자동 진단, 브라우저 소실·SQL 장애에서도 완전한 캡처 보장, 이번 전체 backend 통합 재실행·AWS 검증은 포함하지 않는다. #298 합성 캡처 기록과 #20의 AWS 완료 조건은 그대로 남긴다.
