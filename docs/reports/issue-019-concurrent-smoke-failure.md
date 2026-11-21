# 동시 입찰 첫 smoke 실패와 snapshot 계약 진단

첫 실제 두 사용자 smoke는 INVALID_RESULT로 실패했다. 두 HTTP 요청과 화면 갱신은 관측됐지만 판정기 가정과 기존 WebSocket snapshot 계약이 달랐다. 정식 10회는 실행하지 않았고, 코드·timeout·P95 기준 변경이나 자동 재시도 없이 실패를 보존했다. [사양 보완 제안](../specs/issue-019-concurrent-snapshot-alignment.md)은 승인 후 별도로 구현한다.

## 실행 조건

- 소스: #278 병합 commit `c0e756e1483e252f306c7f00d15a790a2863893d`.
- 실행/복원: 2026년 11월 21일 03:10:33–03:11:04 UTC.
- Mac15,12·arm64·8 CPU·16 GiB, Darwin 25.5.0, Java 21.0.7, Node 24.18.0, Chromium 145.0.7632.6. Docker 27.5.1, 8 vCPU·약 7.65 GiB.
- PostgreSQL·Kafka·Redis·SeaweedFS는 healthy였다. 기존 API의 완전 종료 뒤 별도 local,e2e JVM을 실행했고, jar 안의 local 100ms 설정과 간격/프로필 환경변수 override 제거를 확인했다. 기본 INFO를 유지했다.
- Vite는 실행 전 꺼져 있었으며 검증용으로 loopback에만 시작했다. Playwright는 worker 1·retry 0·명시적 concurrent/smoke 플래그를 사용했다.

원본: [실패 관측·SQL 진단·환경·Lag·복원](evidence/issue-019-concurrent-smoke-failure.json). trace·screenshot과 원문 로그는 로컬 임시 경로에만 보존하고 커밋하지 않았다.

## 실제 관측

새 경매 `889d3294-9cfe-4cd4-a18c-c03dd37f7508`에 A가 11,000원, B가 12,000원을 제출했다. 두 요청 모두 202 RECEIVED와 서로 다른 requestId를 받았고, 개인 승인 안내와 양쪽 공개 12,000원이 확인됐다. 그러나 다음 차이 때문에 기존 판정기가 표본을 거부했다.

| 사용자 | 사후 원장과 결과 Outbox | 개인 frame | 기존 판정 |
|---|---|---|---|
| A | ACCEPTED, 11,000원·version 2 | ACCEPTED, 12,000원·version 3 | 제출액과 frame 가격이 달라 INVALID_RESULT |
| B | ACCEPTED, 12,000원·version 3 | ACCEPTED, 12,000원·version 3 | A 표본의 실패로 전체 회차 실패 |

두 POST 관측은 수집 시작 이후 약 85.250ms/85.456ms, 첫 개인 frame은 506.626ms에 수신됐다. 따라서 수집 시각상 두 번째 POST는 첫 개인 결과보다 먼저였다. 하지만 판정기가 결과를 거부했으므로 이 사실만으로 회차 성공을 표시하지 않는다.

원본의 `completed=0`, `incomplete=20`, 백분위 null과 `smokeVerified=false`를 유지한다. 여기서 20은 정식 실험의 목표 크기다. 실제 시도는 smoke 한 회차의 2건이며 나머지 18건을 실행하거나 timeout 처리한 것은 아니다. 약 702ms에 수신한 화면 확인 시각도 유효 P95 표본으로 승격하지 않는다.

정산 Consumer의 세 partition Lag는 smoke 전후 모두 0이었다. partition 1의 offset이 2 증가해 두 명령과 일치했다. 실행 중 peak나 정확한 회복 시간은 관측하지 않았다.

## 원인과 사후 SQL

`BidRealtimeKafkaListener.publishBidResult`는 decision/reason을 해당 이벤트에서 가져오지만 currentPrice/auctionVersion은 소비 시 조회한 현재 PostgreSQL snapshot에서 가져온다. [기존 WebSocket 사양](../specs/issue-014-realtime-websocket.md)의 I도 과거 event에 더 큰 snapshot version을 전송할 수 있다고 명시한다.

반면 `judgeConcurrentRound`는 승인 frame의 가격이 제출액과 같아야 한다고 요구한다. `judgeConcurrentSql`도 Outbox의 정산 version과 frame의 최신 version이 같다고 가정한다. 전자는 실제 실패 원인이며, 후자도 같은 시점 혼동을 가진다. 이번 E2E는 SQL 단계 이전에 중단됐으므로 후자를 실제 E2E의 두 번째 실패로 기록하지는 않는다.

복원 후 해당 경매와 두 requestId만 읽는 별도 진단 SQL을 실행했다. 요청·원장·결과는 각각 2건이고 요청당 원장/결과는 1건이었다. A/B 승인 이벤트의 version은 각각 2/3, 최종 경매는 ACTIVE/12,000원/version 3·승자 B·원래 마감 12:30 UTC였다. 이 자료는 기존 E2E의 SQL 판정 통과가 아니라 **실패 후 진단**이다. JSON의 officialSqlVerification과 sqlVerified는 false로 유지했다.

A의 isHighestBidder=true도 승인 이벤트에서 가져온 값이므로 최종 B 승리와 기준 시점이 다르다. 이를 최종 최고 입찰자 증거로 쓰지 않았으며, 현재 최고 입찰자라는 화면 문구의 시점 문제를 해결했다고 주장하지 않는다.

## 복원과 후속 작업

검증 JVM과 Vite의 완전 종료를 확인했다. 원래 jar hash를 유지한 채 local/명시적 Outbox 1,000ms/INFO 인자로 API를 복원했고, 실제 listen PID 26722·실행 인자·readiness 200/UP을 확인했다. 임시 E2E Clock은 JVM과 함께 종료됐다. Vite는 다시 꺼진 상태다.

새 상품·경매·요청은 시험 증적으로 남겼으며 삭제하지 않았다. 볼륨·Redis 키·offset 초기화나 AWS 작업은 없었고, 원본 폴더의 미추적 복제 파일과 루트 package-lock.json도 보존했다.

이번 변경은 실패 보고서·증적·사양 보완 제안뿐이다. 제품/관측 코드나 임계값을 바꾸지 않아 새 RED/GREEN 구현은 없다. 정식 10회·성능 목표 달성은 미완료이며 #19는 열린 상태다. 제안이 승인되면 현재 계약을 재현하는 실패 테스트부터 관측 판정을 수정하고 새 Fixture로 다시 smoke를 실행한다.

기존 Node 테스트 54개는 모두 통과했다. 기존 가짜 frame들이 요청별 가격/version과 snapshot의 시점 차이를 담지 않아 이 오류를 잡지 못했다. 저장한 실제 입력으로 기존 판정의 INVALID_RESULT를 다시 계산하고, SQL의 가격/version 체인·Lag 전후·복원 기록과 일치하는지 확인했다. 문서 로컬 링크 12개와 diff whitespace 검사도 통과했다. 단위 테스트 성공을 이번 smoke 성공으로 바꾸지 않는다.
