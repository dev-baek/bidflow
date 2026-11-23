# 접수 계측을 포함한 천 건 부하 검증 계획

- 상태: #311 병합 승인 후 smoke 1회 통과 및 본 실행 1회 수행. 계측 연결 1,000/1,000, SQL 시간 초과로 전체 미완료. [결과](../reports/issue-019-ingress-full-verification.md). 기존 [#19](https://github.com/dev-baek/bidflow/issues/19)의 실행 범위다.
- 기반: [#310 계측 smoke 결과](../reports/issue-019-bid-ingress-live.md), [동일 실행 원장·브라우저 판정](issue-019-load-browser-convergence.md), [#305 이후 보호 조건](issue-019-load-browser-revalidation.md).

#310에서 10건의 서버 계측 연결과 smoke 판정이 통과했다. 이번에 확인할 것은 **같은 로컬 1,000건 실행**의 접수·정산·두 브라우저 화면과 서버 계측이 함께 완전한지다. #302의 본 실행 SQL 실패와 #306의 smoke 성능 미달은 그대로 남긴다. 이번 결과를 이전 실패의 원인 해결이나 계측 오버헤드 비교로 사용하지 않는다.

## S. 같은 경매의 화면

기존 관측자 A/B는 서로 다른 Chromium context에서 같은 활성 경매를 열고 초기 10,000원과 공개 구독을 확인한다. 입찰, 새로고침, 별도 화면 갱신 없이 앱의 기존 구독·상세 조회로 smoke 510,000원과 본 실행 50,010,000원을 확인한다. 두 브라우저 관측을 요청별 WebSocket 지연 표본으로 세지 않는다.

## D. 자료 연결과 보존

smoke와 본 실행은 각각 새 경매·runId·외부 보호 경로를 만든다. 기존 금액·합성 actor·멱등 키·마감과 DB 판정 규칙을 사용한다. HTTP 유효 접수 모두를 해당 경매의 요청·원장·결과 이벤트에 대조하고, 마지막 승인 도메인 eventId·version·가격·마감이 A/B의 공개 frame 및 그 뒤 DOM 확인과 일치하는지 검증한다.

각 실행의 receipts 전체를 동일 시험 JVM의 `bid.request.received`와 `bid.ingress.timing`에 연결한다. 같은 JVM을 공유해도 단계별 상관 ID·요청 ID·경매를 섞지 않고, 접수 로그의 auctionId를 확인한다. 중복·누락·파싱 오류·시간 순서 오류가 있으면 연결이 불완전하다. 불리한 표본이나 중복 로그를 미리 제거하지 않는다.

## B. 실행기와 지표

기존 `run-focused-load.mjs`의 브라우저 모드와 `joinBidIngress`를 재사용한다. 서버·쿼리·스키마·관측 주기·임계값 변경이나 장애 주입은 없다. k6 HTTP, 서버 필터, 접수 서비스 시간을 같은 요청의 별도 값으로 저장하고 필터 내 서비스 경계의 중첩을 확인한다. 서버 단조 시계를 클라이언트 시각과 빼거나 서로 다른 백분위로 지연 차이를 계산하지 않는다.

원본은 저장소 밖의 보호 경로에 두고 허용 필드만 보고한다. 요청별 세 구간·전체 분포, HTTP·SQL·자원·Lag/DLT 판정, A/B와 복원 상태를 남긴다. 원문 로그·헤더·토큰·환경변수·SQL은 커밋하지 않는다.

## I. 로컬 실행과 복원

승인 main SHA의 깨끗한 별도 worktree에서 `make verify`, Java 21·Node 24·k6·Chromium, 로컬 Docker 소켓, 서비스 health와 기존 API readiness를 확인한다. 기존 API의 PID·소유권·정확한 인자·jar hash를 확인할 수 없거나 5173 포트·다른 부하가 확인되면 시작하지 않는다.

검증 중에만 승인 SHA의 JVM을 `local` 단독/system Clock/100ms/INFO, loopback:8080과 `--bidflow.bid.ingress-timing=true`로 띄우고 기존 로컬 Vite를 사용한다. `runtime.apiMode=INGRESS_TIMING`을 확인한다. 기존 HTTP 5초·부하 120초·SQL 4초/5초·회복/화면 60초·전체 관측 300초와 자원 제한을 유지한다. 다른 서비스나 기존 데이터·볼륨·Redis key·Kafka offset은 초기화하지 않는다.

성공·실패와 관계없이 소유 부하·브라우저·Vite·검증 JVM만 정리하고 원래 API를 정확한 인자와 jar로 복원한다. 정리/복원 확인이 실패하면 통과 처리하지 않는다. 추가 사후 조회·AWS 작업은 승인에 포함되지 않는다.

## T. 단계와 승인 횟수

| 단계 | 단 한 번의 허용 조건과 판정 |
|---|---|
| smoke | 새 경매 10건(2 VU × 5회). 기존 `valid=true`·`browserObservationValid=true`·`fullVerified=false`, exit 0, 계측 10/10 및 단계 정리를 모두 확인해야 본 실행으로 간다. #310의 이전 통과로 새 smoke를 대신하지 않는다. |
| 본 실행 | smoke가 통과한 뒤 별도 경매 1,000건(20 VU × 50회). 기존 성능(P95 < 300ms, 오류율 < 1%)·원장·두 화면·자원·Lag/DLT 검증에 더해 계측 연결 1,000/1,000과 원래 API 복원이 모두 확인되어야 전체 검증 통과다. |

smoke 실패면 본 실행을 시작하지 않는다. 본 실행이 실패해도 자동 재시도하거나 제한을 바꾸지 않는다. 승인 횟수는 smoke 최대 1회·본 실행 최대 1회다. `fullVerified`는 기존 실행기의 판정으로 보존하고, 서버 계측 연결 결과와 전체 결과는 따로 표시한다. 1,000건은 20 VU의 누적 제출이며, 1,000건 전체 동시 HTTP나 운영/AWS 성능 검증이 아니다.
