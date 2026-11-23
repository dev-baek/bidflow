# 천 건 부하의 브라우저 수렴 재검증 계획

- 상태: 검토 대기. 기존 [#19](https://github.com/dev-baek/bidflow/issues/19)의 실행 승인 범위다.
- 기반: [동일 실행 브라우저 수렴 사양](issue-019-load-browser-convergence.md), [#302 실행 결과](../reports/issue-019-load-browser-convergence.md), [#304 실패 기록 보완](issue-019-scoped-sql-reliability.md).

## 검증할 질문

#302는 1,000건을 모두 접수했으나 부하 직후 첫 SQL이 4초 제한으로 취소되어 같은 실행의 원장·DOM·DLT 판정을 마치지 못했다. #304는 실패 분류와 이미 완료된 화면 기록을 보존하지만 쿼리를 빠르게 만든 변경은 아니다. **같은 로컬 조건으로 새 실행을 한 번 검증해 원장과 두 화면까지 연결되는지 확인한다.** 이전 실패는 보존한다. 새 실행이 통과해도 이전 시간 초과의 원인이나 해결을 입증한 것으로 보지 않는다.

## S. 두 화면의 확인 범위

기존 Playwright 관측자 A/B가 서로 다른 Chromium context로 같은 활성 경매의 초기 10,000원과 공개 구독 준비를 확인한다. 두 관측자는 입찰하지 않는다. 앱의 기존 WebSocket → 상세 조회 경로만 사용하며, 새로고침 없이 두 화면에서 마지막 승인 가격을 확인한다. 관측 대상은 smoke의 510,000원, 본 실행의 50,010,000원이다. 구독 전송만으로 성공으로 보지 않는다.

## D. 새 시험 데이터와 대조

smoke와 본 실행은 각각 새 runId·상품·경매와 별도 출력 경로를 사용한다. 기존 합성 actor·금액·멱등 키·31분 마감 계획을 유지한다. 이전 경매를 재사용하거나 기존 데이터, 볼륨, Redis key 및 Kafka offset을 초기화하지 않는다.

모든 접수 ID를 해당 경매의 요청·원장·승인/거절 결과와 대조하고, 승인 version·가격·승자·마감을 확인한다. 마지막 승인 도메인 eventId·version·가격·경매 ID·마감이 A/B의 공개 frame과 모두 같아야 한다. DOM 관측은 같은 역할의 최종 eventId 수신 뒤 확인한 기록이어야 한다. SQL이 실패하면 허용된 실패 코드와 그때까지 완료된 frame/DOM 후보를 별도로 남기며, 없는 확인 시각을 채우거나 최종 일치로 간주하지 않는다.

## B. 기존 도구와 해석 경계

기존 실행기와 브라우저 관측을 그대로 사용한다. 앱·SQL·스키마·제한·관측 주기를 바꾸지 않고, 부하 중 추가 진단 쿼리나 의도적인 장애를 넣지 않는다.

```sh
node scripts/run-focused-load.mjs <새-외부-상위경로>/smoke smoke http://127.0.0.1:5173
# 아래 T 절의 smoke 조건이 모두 충족된 경우에만 실행
node scripts/run-focused-load.mjs <새-외부-상위경로>/full full http://127.0.0.1:5173
```

오류 코드는 PostgreSQL 쿼리 취소 `SQL_QUERY_CANCELED`, 로컬 프로세스 제한 `SQL_PROCESS_TIMEOUT`, 출력 오류 `SQL_OUTPUT_INVALID`, 기타 호출 실패 `SQL_CALL_FAILED`로 구분한다. 57014만으로 statement timeout을 확정하지 않는다. 필요하면 실패 시간대의 PostgreSQL 로그에서 취소 사유만 확인해 기록한다. 부하 없이 확인하더라도 원문 SQL과 오류·토큰은 노출하지 않는다.

## I. 실행 자원과 복원

1. 승인된 main SHA의 깨끗한 별도 worktree에서 `make verify`, Java 21·Node 24·k6·Chromium, 로컬 Docker Unix 소켓, 5개 BidFlow 컨테이너 health 및 기존 API readiness를 확인한다. 실행 ID가 붙은 소유 부하가 남아 있거나 5173 포트가 사용 중이면 임의로 종료하지 않고 보류한다. 각 실행은 기존 초기 Lag 0/DLT 기준 확인을 통과해야 한다.
2. 실행 전 API의 소유 PID·실행 인자·jar hash·listen/readiness를 확인한다. 소유권이나 복원 경로가 불명확하면 시작하지 않는다. 검증 기간에만 승인 SHA의 jar를 local/system Clock/100ms/INFO 및 127.0.0.1 바인딩으로 사용한다. Vite도 loopback 5173과 정해진 로컬 API/WS 주소만 사용한다. Docker 자원, DB 설정, 상시 서비스는 변경하지 않는다.
3. 준비 20초, 요청 5초, k6 120초, SQL read-only 4초/호출 5초 및 기존 리소스 중단 기준을 유지한다. 회복과 화면 관측은 부하 종료 관측 +60초의 같은 마감을 사용하며 전체 관측 예산은 기존 300초다. 명령 실패·리소스 경보·브라우저 소실이 있으면 성공 판정을 중단하고, 남은 소유 프로세스는 별도 정리한다.
4. 성공 여부에 관계없이 소유 k6/브라우저·Vite·검증 JVM의 종료를 확인하고 원래 API의 jar·인자·listen/readiness를 복원한다. collector의 검증 JVM 불변 확인과 원래 API 복원은 따로 기록한다. 복원 실패 시 전체 성공 선언이나 추가 실행 없이 상태를 보고한다.

원본은 저장소 밖의 새 보호 디렉터리에 보존한다. SQL 호출이 실패한 경우 원래 API 복원 뒤 실패한 새 경매만 동일한 제한의 읽기 전용 SQL로 **최대 한 번** 사후 대조할 수 있다. 사후 결과는 별도 시각에 관측한 상태로만 기록하고 본 실행을 통과 처리하지 않는다. AWS 접근·배포·리소스 조작은 이 승인에 포함되지 않는다.

## T. 승인할 횟수와 통과 조건

| 단계 | 허용 횟수와 통과 조건 |
|---|---|
| smoke | 새 경매 1회, 2 VU × 5회. exit 0과 10건의 유효 접수·정산·원장 대조, 기존 관측/자원/성능 완전성, A/B의 최종 frame·DOM 및 단계 정리를 모두 검증한다. `valid=true`, `browserObservationValid=true`, `fullVerified=false`가 아니면 종료한다. |
| 본 실행 | smoke와 정리 확인이 모두 통과한 뒤 별도 새 경매 1회, 20 VU × 50회. 1,000건의 유효 접수·정산·원장, 미처리/중복 0, 최종 eventId와 A/B DOM 일치, 마감 내 Lag 0과 DLT 불변, 완전한 자원/명령/증적 및 기존 HTTP P95 < 300ms·오류율 < 1%가 모두 필요하다. `valid=true`, `browserObservationValid=true`, `fullVerified=true`와 원래 API 복원을 확인한다. |

허용 실행은 smoke 최대 1회·본 실행 최대 1회다. 실패 시 새 부하, 자동 재시도, 조건 완화 또는 1,000건 결과 합산은 하지 않는다. 결과에는 실행 SHA·시각·런타임, 요청·정산 집계, HTTP/Lag/DLT와 SQL 결과, A/B frame·DOM 관측값과 실패/복원 상태를 구분해 남긴다. 관측값은 단일 Node 시계에서 계산하고, 두 화면의 수렴을 요청별 전달 P95나 1,000건 전체 동시 HTTP로 설명하지 않는다.
