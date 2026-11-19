# [Issue #19/#18] 브라우저 20건과 Outbox 구간 실측

- 실행일: 2026-11-19. 기준 소스: `b80fd21932b9e725d85c9ceec27cdc484439b642`.
- 사양: [Outbox 구간 계측](../specs/issue-019-outbox-timing.md), 선행: [동일 요청의 두 관측 비교](issue-019-paired-browser-observation.md).
- 원본: [브라우저 20건](evidence/issue-019-outbox-browser.json), [SQL 연결·허용 필드 로그 80개·구간 집계](evidence/issue-019-outbox-timing.json).
- 환경: 로컬 Chromium 145.0.7632.6, Node 24, Java 21 `local,e2e`, Vite와 기존 Docker PostgreSQL·Kafka·Redis·OpenSearch·객체 스토리지. AWS 사용 없음.

## 결과

새 시험 경매에서 두 사용자가 번갈아 20건을 순차 제출했다. 20건 모두 승인되고 두 화면의 현재가와 개인 결과가 일치했다. 기본 관측 지연 P95는 **2,936.95ms로 2초 기준 실패**다. 계측 로그가 생겼다는 이유로 성공 처리하거나 임계값을 바꾸지 않았다.

| 브라우저 지표(각 20건) | P50 | P95 | P99 |
|---|---:|---:|---:|
| HTTP 202 수신 관측 | 53.60ms | 95.42ms | 103.44ms |
| 개인 결과 frame runner 수신 | 1,487.11ms | 1,998.79ms | 2,137.89ms |
| 기본 화면 완료 관측 | 1,926.36ms | 2,936.95ms | 2,980.02ms |
| 같은 요청의 25ms 보조 관측 | 1,504.87ms | 2,014.03ms | 2,157.82ms |

이번에는 보조 관측 P95도 2초를 넘었다. 기본 관측은 기존 Playwright 기본 polling·locator 단언이고, 보조 관측은 동일 요청·동일 클릭 시작점에서 동시에 실행했다. 둘 다 실제 브라우저 paint 시각은 아니며 보조 관측은 추가 브라우저 작업을 발생시킨다. 이전 회차와의 차이를 앱 성능 개선/악화로 판단하지 않는다.

## Outbox: 명령·결과 각각 20개

| 이벤트 | 구간 | P50 | P95 | P99 |
|---|---|---:|---:|---:|
| BidCommandRequested | DB INSERT→SELECT age | 411ms | 912ms | 998ms |
| BidCommandRequested | 조회 반환→발행 호출 | 0.001834ms | 0.003666ms | 0.004042ms |
| BidCommandRequested | 직렬화/전송→Kafka ack | 4.172916ms | 7.921541ms | 8.640959ms |
| BidAccepted | DB INSERT→SELECT age | 997ms | 1,003ms | 1,005ms |
| BidAccepted | 조회 반환→발행 호출 | 0.002417ms | 0.003459ms | 0.005584ms |
| BidAccepted | 직렬화/전송→Kafka ack | 4.239542ms | 6.560083ms | 9.160417ms |

이 시험의 **측정된 Outbox 구간 중에는 DB INSERT→조회 age가 가장 크다.** 명령과 결과가 각각 미발행 조회를 거치며, 결과 age가 약 1초에 모이는 현상은 기존 Scheduler의 작업 종료 후 1,000ms fixed delay와 부합한다. 다만 간격을 바꾼 대조 실험은 하지 않았으므로 단독 원인이나 단축 효과를 확정하지 않는다.

DB age는 commit 이전 트랜잭션 시간과 DB wall clock 보정 영향을 포함한다. 정확한 commit 이후 큐 대기라고 부르지 않는다. batchWait·sendAck는 JVM 단조 시계다. 서로 다른 경계·시계를 사용하므로 세 지표나 명령/결과의 P95를 합쳐 브라우저 지연으로 간주하지 않는다. Consumer 처리·Projection·WebSocket 전파 등 미계측 구간도 남아 있다. 로그의 `@timestamp`는 연결 보조 정보이며 이를 빼서 새 지연을 만들지 않았다.

## 연결·무결성 확인

시험 경매 `2801ed33-fcfe-4b98-be25-4ccc8406bbe1`만 읽기 전용 SQL로 조회했다. Outbox `payload.bidRequestId`로 브라우저의 20개 requestId를 연결하고, `event_id`로 계측 로그를 연결했다. 원본 payload·금액·사용자 ID·토큰·예외 원문은 로그 증적에 복사하지 않았다.

- 명령 20개·승인 결과 20개 모두 서로 다른 eventId이며, 각 종류의 requestId 집합이 브라우저 표본과 정확히 일치했다.
- 이벤트마다 `event.acknowledged` 1개와 `event.published` 1개: 총 80개. 누락·중복·실패 로그 0개. 같은 이벤트의 두 로그는 topic·eventType·age가 일치했다.
- 각 구간 유효 수치 표본 20개. age `MISSING`/`INVALID` 0개. 결측을 0으로 대체하지 않았다.
- 요청·승인 요청·원장·승인 원장·서로 다른 원장 requestId·정산 이벤트는 각 20개. version 순 현재가 역행 0개.
- SQL 수집 당시 `ACTIVE / version 21 / 30,000원`, 최종 승자·금액은 최신 승인 이벤트와 일치했다. 이후 서버를 `local` 프로필로 복원했다. 시험 데이터는 삭제하지 않았다.

Kafka ack는 broker 확인이고 DB 발행 표시는 별개다. 이번 성공 표본에는 둘 다 있지만, 장애·재발행에서도 중복이 없음을 입증한 실험은 아니다.

## 재현과 검증

계측이 포함된 API를 `local,e2e`로 실행하고 기존 Vite를 사용했다. API 로그에서는 `com.bidflow.runtime.OutboxTimingLog`만 받아 사양의 허용 필드를 추출했다. 새 시험의 SQL eventId 집합으로 다시 필터링했으며 로그 전체·Playwright trace·스크린샷은 커밋하지 않았다.

```sh
# apps/web에서 실행, 서비스는 localhost에 준비
BIDFLOW_E2E_BASE_URL=http://127.0.0.1:5173 BIDFLOW_E2E_LATENCY=1 \
  npx --yes node@24 ./node_modules/@playwright/test/cli.js test \
  --workers=1 --reporter=list --output=/tmp/bidflow-outbox-run \
  --grep '순차 입찰 20건'

# 저장소 루트에서 실행
node --test tests/scripts/browser-result-latency.test.mjs \
  tests/scripts/final-settlement.test.mjs tests/scripts/measure-final-settlement.test.mjs
```

지연 E2E 1개는 기본 P95 단언에서 실패했고, 앞선 20건 완료·최종 경매 단언은 통과했다. Node 테스트 10개는 통과했다. 이번 문서 작업에서 백엔드 전체 테스트를 다시 실행하지 않았으며, 계측 구현 테스트 결과는 [#264 검증 보고](issue-019-outbox-timing-implementation.md)에 별도로 남아 있다.

모든 브라우저 요약을 원본 표본에서 다시 계산해 일치 확인했다. Outbox 요약은 종류별 eventId를 기준으로 ack 로그에서 age·sendAck, published 로그에서 batchWait를 각각 한 번만 취한다. `scripts/final-settlement.mjs`의 nearest-rank 백분위(`ceil(n × p)`번째 정렬 표본)를 사용한다. 20건에서는 P95가 19번째, P99가 최대값이므로 충분한 운영 분포를 뜻하지 않는다.

## 다음 작업 경계

#19/#18은 열린 상태다. 다음에는 기존 #19에서 Scheduler 간격의 로컬 대조 실험 사양부터 정한다. 기본값을 바로 바꾸지 않고 동일한 입찰/관측 조건에서 지연·조회 빈도·DB 부하의 절충을 확인해야 한다. 동시 부하·장애 복구·AWS 검증은 이번 실측의 범위가 아니다.
