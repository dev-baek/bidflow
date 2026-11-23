# 로컬 입찰 접수 계측의 실제 요청 검증

- 상태: 실행 승인 대기. 기존 [#19](https://github.com/dev-baek/bidflow/issues/19)의 후속 검증이다.
- 기반: [#308 접수 계측 구현](issue-019-bid-ingress-timing.md), [#306 smoke](../reports/issue-019-load-browser-revalidation.md), [요청별 지연 진단](../reports/issue-019-smoke-http-diagnosis.md).

#306의 빠른 SQL 대조와 HTTP P95 기준 미달은 별개였다. 서버 접수 서비스와 필터 경계를 실제 응답에 연결해, 느린 요청을 다음에 어느 경계로 좁힐 수 있는지 확인한다. **승인 범위는 새 경매의 10건 smoke 1회이며, 성공하더라도 1,000건 본 실행은 하지 않는다.**

## S. 관측할 사용자 흐름

`focused-thousand` smoke(2 VU × 5회)를 사용한다. 기존처럼 Chromium 관측자 A/B는 입찰 없이 같은 경매를 구독하고 새로고침 없이 최종가를 확인한다. 202 접수, SQL의 최종 정산, A/B 화면 일치를 각각 본다. Kafka 정산과 화면 수렴은 HTTP 시간에 포함하지 않는다.

## D. 연결할 실제 기록

새 runId·경매·출력 경로를 사용한다. 새 경매의 접수에서 얻은 **응답 correlationId와 bidRequestId**가 동일 시험 JVM의 `bid.request.received` 1개 및 `bid.ingress.timing` 1개와 모두 일치해야 한다. 접수 로그의 auctionId도 시험 경매와 대조한다. 동일 correlationId의 중복이나 다른 ID, 누락, 잘린 로그, 잘못된 중첩은 미완료다. 실제 검증에는 재전송이나 장애를 의도적으로 넣지 않는다.

허용 필드는 소스·합성 실행 식별자, 응답 상태, 요청별 경과 시간, 고정 판정과 기존 정산/관측 집계다. 원본 receipts·서버 로그·출력은 새 외부 보호 디렉터리에 두고, 원문 URL/본문·토큰·헤더·환경 내용·SQL은 PR에 올리지 않는다.

## B. 구간과 순수 판정

`joinBidIngress`에 해당 실행의 receipts와 시험 JVM의 로그를 넣어 연결 여부를 재계산한다. **원래 10개 receipts 전체**를 입력하며, 연결 실패 표본부터 빼거나 중복 로그를 사전에 제거하지 않는다. HTTP 202/RECEIVED이며 같은 ID에 대해 `0 ≤ receiveStartNanos ≤ receiveEndNanos ≤ httpNanos`인 연결만 유효하다.

| 비교 항목 | 실제 측정 경계 |
|---|---|
| k6 HTTP duration | 클라이언트가 관측한 해당 응답의 경과 시간 |
| HTTP 필터 시간 | 서버 필터 진입부터 필터 체인 반환까지. 진입 전·소켓 전송 완료는 측정하지 않는다. |
| 접수 서비스 시간 | 같은 서버 단조 시계의 receiveEndNanos − receiveStartNanos. 멱등 조회와 저장을 포함하며, SQL 쿼리 자체의 시간은 아니다. |

서버 구간은 같은 요청의 중첩으로 비교한다. 서버와 k6의 타임스탬프 또는 서로 다른 백분위는 빼지 않는다. #306과의 차이는 계측 오버헤드 비교나 지연 원인 해결로 해석하지 않는다. 새 표본이 임계값을 넘지 않으면 느린 요청이 재현됐다고 보고하지 않는다.

## I. 실행 조건과 복원

승인된 main SHA의 깨끗한 별도 worktree에서 `make verify`와 패키지, Node 24·Java 21·기존 로컬 k6 이미지·Chromium, Docker Unix 소켓, BidFlow 컨테이너 5개의 health와 현재 API readiness를 확인한다. 기존 API의 소유 PID·jar hash·인자·listen을 확인할 수 없거나, 다른 부하 또는 5173 포트 점유가 발견되면 시작하지 않는다.

검증 중에만 승인 SHA의 jar를 `local` 단독/system Clock/100ms/INFO·loopback 설정에 기존 인자 뒤 `--bidflow.bid.ingress-timing=true`를 붙여 띄운다. `local,e2e`·환경 변수 override·원격 endpoint는 쓰지 않는다. Vite는 127.0.0.1:5173, API/WS는 127.0.0.1:8080으로 제한한다. 기존 실행기에서 `runtime.apiMode=INGRESS_TIMING`을 확인한다.

```sh
node scripts/run-focused-load.mjs <새-외부-상위경로>/smoke smoke http://127.0.0.1:5173
```

기존 부하·SQL·관측 마감과 자원 중단 기준을 유지한다. 예외나 실패 시에도 시험 JVM·브라우저·Vite·소유 부하를 정리하고, 원래 API의 정확한 인자·jar hash·listen PID·readiness를 확인해 복원한다. 다른 서비스, 기존 데이터·볼륨·Redis key·Kafka offset은 변경하지 않는다.

## T. 서로 다른 완료 판정

1. 실행은 **최대 한 번**이다. 계측 활성 모드, 고유한 응답/접수/타이밍 연결 10/10, 중첩 순서·증적·정리·원래 API 복원이 모두 확인되면 실제 계측 검증 통과다. 부분 기록은 따로 남긴다.
2. smoke 성공 여부는 기존 `valid`를 그대로 보고한다. 정합성·자원·Lag/DLT·브라우저와 HTTP P95 < 300ms 및 오류율 < 1% 기준을 유지한다. 지연 초과가 있어도 연결 기록은 진단에 쓸 수 있으나 smoke 성공으로 바꾸지 않는다.
3. 결과에는 두 판정과 실패/누락 건수, 요청별 세 구간, 최종 SQL·A/B 관측, 실행 SHA·시각과 복원을 구분해 남긴다. 실패·조건 미달이면 자동 재시도나 임계값 변경은 없다. #306의 성능 미달과 #302의 SQL 실패는 그대로 둔다.

1,000건 본 실행, 인위적 지연·장애 주입, 추가 사후 DB 조회, AWS 작업은 이 계획의 승인 범위 밖이다.
