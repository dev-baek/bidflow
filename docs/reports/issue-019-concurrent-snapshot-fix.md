# 동시 입찰 snapshot 판정 수정과 10회 실측 결과

승인된 [snapshot 구분 사양](../specs/issue-019-concurrent-snapshot-alignment.md)에 따라 동시 관측 판정과 SQL 대조를 수정했다. 새 smoke 뒤 별도의 새 경매로 두 건씩 10회 제출한 정식 20건이 모두 완료됐고 SQL 대조 10회도 통과했다. **화면 수렴 관측 P95는 443.33ms**로 이 로컬 실험의 2초 기준을 통과했다.

이 결과는 20건 전체 동시 요청이나 운영/AWS SLO가 아니다. [이전 실패 smoke](issue-019-concurrent-smoke-failure.md)는 재판정하거나 성공 표본에 합치지 않았다.

## 판정 수정과 TDD

개인 메시지의 판정은 요청별 사실이지만 가격/version은 최신 snapshot일 수 있다. 동시 관측 표본의 auctionVersion을 snapshotVersion으로 명확히 구분하고 snapshotPrice도 기록했다. SQL 결과에는 별도의 settlementVersion·원장/이벤트 가격과 연결된 snapshot 값을 반환한다.

- A/B 모두 승인되면 A는 11,000원/v2 또는 12,000원/v3 snapshot, B는 12,000원/v3만 허용한다.
- B 승인 뒤 A 거절이면 두 snapshot은 12,000원/v2만 허용한다.
- SQL의 요청별 정산 값은 별도로 검증한다. frame version이 더 크다는 이유만으로 통과하지 않고, 실제 승인 이벤트 체인의 같은 version·가격 쌍과 연결한다. 최종 version을 넘는 snapshot은 실패다.
- 요청·채널·판정·사유, 충돌하는 중복 결과, 시각/timeout·동시성·최종 승자 검증과 P95 2초는 유지했다.

재현 테스트 3개를 먼저 추가했을 때 새 정상 snapshot 사례와 SQL 연결이 거부됐고, 반대로 잘못된 가격/version 쌍 일부는 기존 판정이 허용해 총 3개가 실패했다. 최소 수정 뒤 모두 통과했다. snapshot 조합 테스트는 두 판정 시나리오·두 사용자·5개 version·5개 가격의 100개 조합을 확인한다. SQL 테스트는 정산 v2와 snapshot v3를 분리하면서 원장/이벤트 가격·version·사용자 변조를 계속 거부하는지 검증한다.

전체 Node 테스트 57개와 Vitest 68개가 통과했고 make verify 및 별도 E2E 타입 검사도 성공했다. 로컬 backend unitTest와 bootJar는 기존 결과를 UP-TO-DATE로 재사용했다. 서버 Java·API·메시지 schema·DB migration·collector·순차 측정 matcher는 변경하지 않았다.

## 실측 조건

- 측정 소스 commit: `3335cc5ef6dd38dc168040174f7135f0c3733409`. 코드를 커밋한 뒤 실행했다.
- 실행/복원: 2026년 11월 21일 03:58:28–03:59:22 UTC. 정식 runner는 03:58:45–03:59:13 UTC에 실행됐다.
- Mac15,12·arm64·8 CPU·16 GiB, Java 21.0.7, Node 24.18.0, Chromium 145.0.7632.6. Docker 27.5.1·8 vCPU·약 7.65 GiB.
- PostgreSQL·Kafka·Redis·SeaweedFS healthy. 기존 API 완전 종료 후 local,e2e/100ms/INFO JVM을 사용했다. jar 내부 local 설정과 CLI/환경변수 override 제거를 확인했으며 jar hash도 기록했다.
- worker 1·retry 0, 실행 중인 다른 부하나 Clock 변경 없이 동일 테스트만 실행했다. 자동 재시도는 없다.
- 회차마다 새 경매(시작가 10,000원·초기 v1·마감 10분 전)에 A 11,000원과 B 12,000원을 제출했다. 한 회차를 확인한 뒤 다음 새 경매로 이동했다.

[전체 증적](evidence/issue-019-concurrent-browser-latency.json)은 smoke와 본 실행을 분리하고, 요청별 상대 시각·파싱된 허용 frame 필드·SQL 정산/snapshot 연결·Lag·실행과 복원 정보를 보존한다. 원문 trace·Token·이미지 URL·서버 로그는 커밋하지 않는다.

## 결과

새 smoke는 2건 완료·SQL 확인 성공이었다. 승인 1건·BID_TOO_LOW 거절 1건이며 smokeVerified=true지만, 전체 10회 기준의 valid/P95 달성으로 세지 않는다. 이 표본은 본 실행에 포함하지 않았다.

정식 실행은 새 경매 10개·요청 20개·원장 20개·결과 Outbox 20개다. 승인 15건과 정상 BID_TOO_LOW 거절 5건이었고 미완료·동시성 미충족은 0건이었다. SQL 확인은 10/10 성공이며 모든 경매의 최종 B 승자·12,000원·version/마감 일치를 확인했다.

| 클릭 직전부터의 관측 지연 ms | P50 | P95 | P99 |
|---|---:|---:|---:|
| 접수 응답 본문 완료 | 53.62 | 76.00 | 78.81 |
| 개인 frame 최초 수신 | 228.24 | 301.36 | 318.88 |
| 개인 안내와 양쪽 화면 수렴 | 419.95 | 443.33 | 444.75 |

측정은 동일 Playwright runner의 단조 시계이며 actionability·프로세스 전달·assertion polling 비용을 포함한다. 정확한 paint·순수 WebSocket 전송 시간·DB 커밋 시각이 아니다. 화면 수렴은 회차의 두 사용자가 공유하는 종료점이므로 20개 표본을 독립적인 대규모 통계로 해석하지 않는다.

모든 회차에서 두 번째 POST 관측이 첫 개인 결과보다 먼저였다. 두 POST 관측 간 차이는 약 0.035–18.93ms, 두 번째 POST부터 첫 개인 결과까지의 최소 관측 간격은 150.52ms였다. Promise.all 사용 사실만으로 동시성을 판정하지 않았다.

정식 SQL 연결에서 정산보다 더 최신 snapshot은 5건이었다. 해당 A 요청의 원장/이벤트는 11,000원/v2이고 메시지는 12,000원/v3인 상태를 실제로 검증했다. 따라서 수정한 경계를 본 실행에서도 관측했으며, 나머지 요청의 본인 snapshot/정상 거절도 같은 규칙으로 확인했다.

## Kafka Lag과 복원

정산 그룹의 3개 partition Lag는 각 실행 전후 모두 0이었다. 정식 실행의 log end offset 증분은 16/2/2, 합계 20으로 요청 수와 일치한다. 실행 중 Lag peak나 정확한 회복 시간을 측정한 결과는 아니다.

저장된 관측 입력으로 모든 백분위·완료 수·동시성 판정을 다시 계산해 원본 집계와 일치하는지 확인했다. API 복원 뒤 읽기 전용 SQL을 새로 실행했을 때도 smoke 1회와 정식 10회의 판정 및 정산/snapshot 값이 저장된 11개 SQL 결과와 모두 일치했다. 이 사후 재확인의 소요 시간은 위 지연 표본에 넣지 않았다.

실험 JVM과 Vite의 완전 종료 뒤 원래 jar hash와 local/명시적 1,000ms/INFO 인자로 API를 복원했다. 실제 listen PID 35007과 인자·readiness UP을 확인했다. Vite는 다시 꺼진 상태이며 E2E Clock은 검증 JVM 종료와 함께 제거됐다.

신규 시험 경매와 원장은 증적으로 남겼고 삭제하지 않았다. 기존 볼륨·Redis 키·offset reset과 AWS 작업은 없었다. 원본 작업 폴더의 미추적 복제 파일과 루트 package-lock.json도 보존했다.

## 한계와 후속 판단

이번 결과는 local 100ms 설정에서 두 요청씩 겹치는 10회 직접 입찰 실험이다. 지속/포화 부하, 1,000건 동시 HTTP, 장시간 장애·자동입찰 지연·AWS 배포 성능은 검증하지 않았다. 유휴 polling 비용도 다시 측정하지 않아 기존 [A-B-A 비용 실측](issue-019-outbox-delay-aba.md)을 유지한다.

과거 이벤트의 isHighestBidder와 화면의 현재 최고 입찰자 문구 사이 시점 문제는 이 판정 수정의 범위가 아니며, 최종 승자 판정에 해당 flag를 사용하지 않았다. 초기 E2E timeout의 원인 미확정 상태도 이번 성공으로 변경하지 않는다. 기존 실패 증적은 그대로 보존한다.
