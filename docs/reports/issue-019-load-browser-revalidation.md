# 브라우저 수렴 재검증의 smoke 결과

[#305 승인 계획](../specs/issue-019-load-browser-revalidation.md)에 따라 새 경매에서 smoke 10건을 한 번 실행했다. **요청·원장·최종 이벤트와 두 화면은 일치했지만, HTTP P95 310.50ms가 기준인 300ms 미만을 충족하지 못했다.** 실행기는 smoke를 실패로 처리했고 1,000건 본 실행은 시작하지 않았다.

## 실행 조건과 판정

2026년 11월 23일 17:55:23~17:55:44 JST, 승인된 main `1e9dd050a5dbb7bf6d947feaf6ef51e6b14828f8`의 깨끗한 별도 worktree에서 실행했다. 공유 Mac arm64 16 GiB, Node 24.18.0·Java 21.0.7·k6 0.54.0, local/system Clock/100ms/INFO와 loopback Vite를 사용했다. 실행 전 `make verify`의 Node 127개·Vitest 71개·빌드가 통과했다. 기존 실행기, SQL, 4초 statement·5초 호출 제한을 바꾸지 않았다.

| 항목 | smoke 관측 | 판정 |
|---|---|---|
| HTTP | 2 VU × 5회, 유효 접수 10/10, 오류율 0%. P50/P95/P99 60.95/310.50/312.75ms | 접수 통과, P95 실패 |
| 원장과 최종 상태 | 요청·원장·결과 각 10건, 승인 5·거절 5·미처리 0. ACTIVE, 510,000원/v6, 승자와 마감 일치 | 통과 |
| 공개 frame과 화면 | A/B 최종 frame 도메인 eventId·가격·version·경매·마감이 SQL과 일치. 두 화면 모두 510,000원 확인 | 통과 |
| 수집과 복원 | 자원 판정 통과, 명령 31개 성공, 관측 전후 Lag 0, DLT 오프셋 불변 | 통과 |
| 전체 | k6 exit 99(임계값 실패), 실행기 exit 1. `valid=false`, `browserObservationValid=true`, `fullVerified=false` | 본 실행 미시작 |

A/B 모두 부하 종료 관측 전에 최종 가격을 확인했다. 최종 frame 수신부터 DOM 확인까지 A 5.44ms, B 6.88ms였다. 저장된 frame과 원장으로 순수 판정을 다시 계산해 같은 결과가 나왔고, 두 화면 시각 각각이 새 DOM 기록에 해당 eventId로 남아 있음을 대조했다. 이 값은 두 관측자의 화면 확인 시간이며, 요청별 WebSocket 전달 P95나 화면 paint 시간이 아니다.

## HTTP 지연과 SQL의 구분

10개 접수 시간 중 3개가 300ms를 넘었다(305.23·307.07·313.31ms). k6의 응답 대기 구간 P95는 309.72ms였다. 이는 클라이언트에서 응답 첫 바이트를 기다린 측정값으로, 서버 내부의 특정 단계나 각 구간의 P95를 빼서 병목을 확정할 수 없다. 10건의 단일 smoke만으로 새 회귀나 운영 지연을 단정하지 않는다.

부하 이후 읽기 전용 정산 snapshot 호출은 약 187ms로 성공했다. 이번 중단 사유는 SQL 취소가 아니라 HTTP 기준 미달이다. SQL 실패가 없었으므로 승인된 실패 후 사후 조회는 실행하지 않았다. [#302](issue-019-load-browser-convergence.md)의 본 실행 SQL 시간 초과는 별도 미완료 사례로 유지한다.

## 정리와 남은 범위

17:55:57 JST에 검증 JVM, 소유 부하·브라우저 및 Vite 정리를 확인했다. 기존 1,000ms API를 PID 23439로 복원하고 기존 jar hash·인자·listen·readiness UP을 대조했다. BidFlow 컨테이너 5개의 ID와 healthy 상태는 전후 동일했다. 새 경매 데이터는 보존했고 데이터·볼륨·Redis key·Kafka offset을 초기화하지 않았다.

[구조화 증적](evidence/issue-019-load-browser-revalidation.json)에 판정, 요청별 접수 시간, 최종 frame/DOM·SQL, Lag/DLT·복원 상태를 남겼다. 원본은 로컬 보호 경로에만 두었다. 자동 재시도·1,000건 본 실행·AWS 작업은 하지 않았다. 다음 검토는 저장된 HTTP 표본과 서버 기록을 대조할 수 있는 범위부터 정하며, 지연 기준을 완화하거나 이번 결과를 성공으로 바꾸지 않는다.

[후속 요청별 진단](issue-019-smoke-http-diagnosis.md)은 느린 세 표본을 접수 저장·정산 로그와 연결한다. 지연 구간을 일부 좁혔지만 병목 원인을 확정하지 않는다.
