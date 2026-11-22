# 천 건 부하와 같은 실행의 브라우저 수렴 검증

- 상태: 검토 대기. 구현과 실제 부하 실행은 이 사양 병합 후 진행한다.
- 기존 이슈: [#19](https://github.com/dev-baek/bidflow/issues/19). 별도 이슈를 만들지 않는다.
- 기반: [누적 1,000건 계약](issue-019-focused-thousand-requests.md), [명령 추적 재검증](issue-019-instrumented-rerun.md), [기존 결과](../reports/issue-019-instrumented-rerun.md), [공개 화면 관측](issue-019-concurrent-browser-latency.md).

## 목적과 측정 경계

기존 20 VU 누적 1,000건 실행은 HTTP와 SQL을, 두 사용자 20건 실행은 화면 지연을 검증했다. 이번에는 **같은 부하의 최종 승인 이벤트가 이미 열린 두 브라우저에 도착하고 최종 가격으로 수렴하는지** 확인한다. k6 요청 시계와 브라우저 관측 시계를 빼서 요청별 전달 지연을 만들지 않는다.

측정값은 부하 시작부터 최종 frame/화면 관측까지의 시간, 부하 종료 뒤 남은 대기, 최종 frame 관측부터 화면 확인까지의 시간이다. 실행당 화면 관측자는 두 명이므로 이를 1,000개 지연 표본이나 요청별 전달 P95로 부르지 않는다. 상위 성공 기준의 전달 P95 2초와 1,000건 전체 동시 HTTP는 별도로 남는다.

## S. 관측자 두 명과 최종 화면

서로 다른 Chromium context의 합성 관측자 A/B가 같은 새 경매 상세를 연다. 두 관측자는 입찰하지 않으며 판매자·k6 actor와 다르다. 초기 ACTIVE·10,000원과 각 공개 구독의 준비를 확인한 뒤 부하를 시작한다. Spring simple broker의 SUBSCRIBE 전송은 서버 준비 확인이 아니므로, 준비 뒤에도 최종 도메인 이벤트의 실제 수신을 필수로 검증한다.

페이지를 새로고침하거나 재로그인하지 않고 두 화면이 최종 제출 가격에 도달해야 한다. 기존 앱의 공개 메시지 → 상세 재조회 경로를 그대로 사용한다. 관측기가 별도 GET으로 화면을 갱신하거나 가격을 주입하지 않는다. 구독 중 재연결·페이지 이동·context 소실이 생기면 이 실행의 연속 관측은 실패로 기록한다.

## D. 같은 경매의 이벤트와 원장 연결

smoke와 본 실행마다 새 runId·상품·경매·보호된 외부 출력 경로를 사용한다. 요청 계획·금액·actor·멱등 키·31분 마감 Fixture와 SQL 불변식은 기존 집중 부하 계약을 유지한다. smoke 2 VU × 5회와 본 실행 20 VU × 50회를 섞지 않는다. 최종 기대 가격은 기존 계획 함수에서 구하며 본 실행은 50,010,000원이다.

기존 SQL의 승인 결과를 settlementVersion으로 정렬해 마지막 승인 eventId와 최종 가격/version·승자를 구한다. 두 브라우저에서 같은 auctionId·도메인 eventId·version·가격·endsAt의 `auction.updated`를 실제 수신해야 한다. STOMP message-id로 도메인 ID를 대신하지 않는다. 기존 공개 파서는 eventId/가격을 검증하지 않으므로 앱 계약을 넓히지 않고 수집 경계에서 UUID·안전 정수·시각을 추가 검사한다.

중간 공개 snapshot은 더 최신일 수 있고 건너뛸 수도 있다. 모든 요청마다 공개 메시지가 있다고 가정하거나, 공개 메시지가 없는 정상 거절을 누락으로 세지 않는다. 동일 eventId의 모순된 값은 실패다. 두 관측자의 개인 결과가 아닌 **공개 최종 결과**를 SQL과 연결한다. 최종 화면은 최종 frame 뒤 같은 가격을 확인해야 하며, 부하 전의 화면이나 사후 새로고침만으로 통과하지 않는다.

## B. 순수 판정과 얇은 실행 경계

기존 `collectFocused`·`realIo`·`buildK6Args`·명령 trace·계획/SQL/자원 판정을 재사용한다. 별도 runner나 복제 collector를 만들지 않는다. 새 opt-in 실행 경계에서 필요한 최소 observer lifecycle을 연결하고 기본 CLI의 입출력과 판정은 유지한다. 구체적인 hook은 TDD 중 정하되 observer 없는 기존 테스트가 모두 통과해야 한다.

Playwright는 기존 의존성과 실제 앱 구독을 사용한다. 모든 경계 시각은 **하나의 Node 프로세스가 전달한 단조 시계**로 기록한다. 브라우저 frame 콜백과 DOM 단언 완료 시각도 이 시계에서 찍는다. k6 wall clock, DB 시각, page performance 시계를 산술에 섞지 않는다.

| 필드 | 정의 |
|---|---|
| loadStartedMs / loadEndedMs | 기존 collector의 시작/종료 관측. k6의 첫 송신/마지막 응답 순간과는 다름 |
| finalFrameMs A/B | SQL과 일치하는 최종 공개 이벤트를 처음 수신한 Node 콜백 시각 |
| finalScreenMs A/B | 해당 frame 뒤 최종 가격 DOM 단언이 완료된 Node 시각. paint 시간 아님 |
| frameFromStartMs / screenFromStartMs | 위 시각에서 loadStartedMs를 뺀 값. 전체 부하 구간을 포함 |
| remainingAfterLoadMs | `max(0, finalScreenMs - loadEndedMs)`. 종료 전 수렴이면 별도 boolean과 함께 0으로 기록 |
| frameToScreenMs | finalScreenMs - finalFrameMs. 상세 재조회와 Playwright polling 비용 포함 |

최종 SQL 확인보다 frame이 먼저 와도 버리지 않는다. 부하 시작 전부터 허용 필드만 버퍼링하고 SQL 완료 뒤 eventId로 연결한다. 역할별 최대 2,048개 공개 기록, 원문 frame 8KiB 상한을 두고 초과/잘림/잘못된 해당 경매 frame은 관측 실패로 남긴다. 허용 필드는 역할·경매/이벤트 ID·type·version·가격·endsAt·상대 시각뿐이다. 토큰·헤더·원문 URL/body/frame·console·SQL dump는 JSON에 넣지 않는다.

## I. 로컬 자원과 실패 처리

Node 24·Java 21·기존 local/system Clock/100ms/INFO API와 loopback Vite만 사용한다. `local,e2e` 또는 테스트 Clock은 사용하지 않는다. 원격 URL·인증정보 포함 URL·redirect·기존 출력 경로를 서비스 접근 전에 거부한다. 기존 개발 API의 PID/소유권/정확한 인자/jar hash를 기록하고 필요 시 완전 종료 후 검증 API로 교체한다. 불명확하면 중단하지 않고 보류한다.

관측자 준비는 최대 20초다. k6의 HTTP 5초·부하 120초 및 기존 자원/명령 중단 조건을 바꾸지 않는다. collector의 기존 회복 예산과 관측자의 최종 수렴 대기는 **loadEndedMs + 60초라는 같은 절대 마감**을 공유한다. SQL 조회 뒤 새 60초를 추가하지 않는다. 전체 준비/실행/관측은 300초 이내이며 정리/원래 API 복원은 실패 시에도 수행하고 따로 결과를 남긴다.

관측자 오류가 부하 중 발생하면 소유 부하를 중단하고 부분 표본을 보존한다. 수집 오류를 P95 0이나 성공으로 바꾸지 않는다. listener/context/임시 Vite·검증 JVM·소유 부하 컨테이너만 정리하고 원래 API 인자/jar/listen PID/readiness를 확인한다. 다른 컨테이너·기존 데이터/Redis key/offset/볼륨은 건드리지 않는다. 화면/trace는 기존 보호된 외부 보관 정책을 사용한다. AWS 접근·배포·자원 변경은 포함하지 않는다.

## T. 구현과 제한된 실행 순서

1. 순수 판정 RED: 역할 누락, 다른 경매/eventId, STOMP ID 대체, 잘못된 가격/version/시각, 모순 중복, 잘림, 수신 전 화면 확인, 재연결, 마감 초과와 부분 SQL을 성공으로 세지 않는 테스트를 작성한다. 중복 동일 frame과 SQL보다 이른 frame은 유실 없이 처리한다.
2. 가짜 observer/시계/I/O로 준비 실패 시 부하 미시작, 실행 중 소실 시 중단, 타임아웃·늦은 콜백의 저장 결과 불변, 정리/복원 실패와 기존 collector 비사용 경로를 검증한다. 기존 API/화면 동작은 변경하지 않는다.
3. 구현을 커밋하고 `make verify`와 E2E 타입 검사를 통과시킨다. 승인된 SHA·jar/프로필·도구/호스트 자원·관측자 준비·trace·SQL·Lag/DLT를 기록한다.
4. 새 smoke를 **한 번만** 실행한다. 기존 smoke 판정과 두 관측자 연결/화면·정리 확인이 모두 통과한 경우에만 별도 새 경매로 본 실행을 **한 번만** 수행한다. 실패 시 자동 재시도·조건 튜닝·후속 본 실행은 하지 않는다.
5. 기존 collector의 유효성·성능 판정과 새 browserObservationValid를 따로 보고한다. 전체 성공은 기존 모든 조건과 두 관측자 연결/마감/복원을 모두 충족해야 한다. 현재 측정 정의에 맞지 않는 요청별 2초 P95 판정은 추가하지 않는다.

보고서에는 기존 실행과 새 실행을 분리하고, 허용 필드 원본과 파생 지표를 재계산 가능하게 보존한다. 브라우저 관측 추가에 따른 자원 비용이 있으므로 과거 290.48ms와의 차이를 곧바로 서버 성능 변화로 해석하지 않는다. 이 사양 병합은 구현·실행 완료가 아니며 #19 전체 완료나 AWS 승인을 뜻하지 않는다.
