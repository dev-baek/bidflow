# [Issue #19] 같은 입찰의 기본·고해상도 관측 비교

- 기준 소스: `df99c33d3c0bd3e4cdd4aba87e34c938146b0d53`, 실행일 2026-11-19
- 환경: 기존 로컬 Chromium `145.0.7632.6`·Vite·Java 21 `local,e2e`, Node 24, 같은 Docker 서비스. 백엔드 설정·앱 동작 변경 없음.
- 선행: [기본 관측 2초 기준 실패](issue-019-browser-result-latency.md)
- 원본: [동일 회차의 두 관측 표본](evidence/issue-019-paired-browser.json) · [SQL 보조 집계](evidence/issue-019-paired-browser-db.json)

## 방법

새 시험 경매에서 두 사용자가 번갈아 20건을 순차 제출했다. 같은 클릭 시작점·requestId·개인 frame과 화면을 **두 관측기가 동시에** 확인했다.

- 기본 관측: 기존 `expect.poll` 기본 간격과 locator 단언을 그대로 유지한다. 다음 입찰도 기본 관측이 완료된 뒤에 시작해 기존 회차의 제출 방식을 유지한다.
- 보조 관측: 25ms 간격을 설정한 `expect.poll`에서 해당 개인 결과, 개인 승인 안내, 두 공개 가격의 `isVisible()`을 확인한다. 실제 간격에는 runner·브라우저 왕복 시간이 추가되므로 표본마다 최대 check 간격·횟수도 기록한다.

두 관측은 같은 결과를 보지만 보조 관측이 추가 브라우저 작업을 발생시킨다. 따라서 이전 회차와의 차이를 서비스 처리 속도 개선으로 볼 수 없다. 관측 차이의 주된 근거는 **이번 회차 안의 짝지어진 표본**이다.

## 결과 — 완료 20건, 미완료 0건

| 지표 | P50 | P95 | P99 |
|---|---:|---:|---:|
| 개인 frame 실제 runner 수신 | 1,568.14ms | 1,939.92ms | 2,038.76ms |
| 기본 화면 완료 관측 | 1,930.83ms | **2,930.77ms** | 2,931.42ms |
| 25ms 보조 화면 완료 관측 | 1,597.35ms | **1,964.79ms** | 2,065.35ms |
| 각 표본의 기본 관측 완료 − 개인 수신 | 429.14ms | 892.01ms | 991.50ms |
| 각 표본의 보조 관측 완료 − 개인 수신 | 24.86ms | 42.25ms | 43.43ms |

마지막 두 행은 서로 다른 백분위끼리 뺀 값이 아니라 **각 요청 안에서 뺀 값의 분포**다. 보조 관측의 실제 최대 check 간격은 약 51.64ms로, 설정값 25ms와 동일하지 않았다.

기본 관측 기준 E2E는 여전히 실패했다. 임계값은 2초 그대로이며 기본 표본을 보조 표본으로 바꿔 통과시키지 않았다. 보조 P95만 이번 회차에서 2초 이내였지만 P99는 2초를 넘었고, 여러 회차·동시 부하·브라우저 paint 시각을 검증한 결과도 아니다. **앱 최적화나 운영 SLO 달성을 주장하지 않는다.**

요청·승인 원장·서로 다른 원장 requestId·정산 이벤트는 각 20건이었다. 이벤트 version 순 가격 역행은 0건, 최종가 30,000원과 승자는 최신 승인 이벤트와 일치했다. 측정 종료의 공개 상세는 `ACTIVE / version 21`을 확인했다. 후속 기능 E2E의 Clock 진행으로 사후 SQL 집계에서는 해당 경매가 `ENDED / version 22`였다.

## Outbox 대기를 현재 DB timestamp로 계산하지 않은 이유

소스에서 `OutboxScheduler`는 배치 시작 때의 `Instant.now()`를 `publishPending`에 전달한다. `OutboxPublisher`는 각 이벤트를 발행한 후 `markPublished`를 호출하지만, 저장하는 시각은 그 **배치 시작값**이다. 따라서 `published_at`을 개별 이벤트의 ack 완료 시각으로 사용할 수 없다.

또한 이번 `local,e2e`에서는 정산 이벤트의 `occurred_at`에 테스트 Clock(2030년)이 사용되고, publisher 시각은 실제 시스템 시각이다. 사후 SQL에서 `BidAccepted` 20건 모두 `published_at < occurred_at`이었다. 여기서 timestamp를 빼면 음수 지연이 되며 의미가 없다. 이 값은 증적에 남겼지만 성능 표본에는 넣지 않았다.

개인 frame 수신 전까지 약 1.94초(P95)가 남았다는 것은 관측했지만, **그 전체가 Outbox 대기였다고 확정할 수는 없다.** 다음 계측은 실제 단조 시계와 경계별 로그를 이용해 명령 발행·정산·결과 발행·개인 전파를 구분해야 한다. 고정 테스트 Clock의 업무 시각을 성능 타이머로 재사용하지 않는다.

## 검증과 재현

기존 [브라우저 관측 실행 방법](issue-019-browser-result-latency.md#재현)을 그대로 사용한다. 이번 수정 뒤 그 지연 E2E는 1개 실패(기본 P95 기준)했고, latency 플래그를 끈 별도 실행은 기능 E2E 5개 통과·지연 사례 1개 skip이었다. 플래그 없이 건너뛴 지연 테스트를 성공으로 세지 않는다.

```sh
node --test tests/scripts/browser-result-latency.test.mjs \
  tests/scripts/final-settlement.test.mjs tests/scripts/measure-final-settlement.test.mjs
```

순수 차이 계산은 음수/잘못된 timestamp를 거부하고, 보조 관측이 기본보다 늦을 때의 음수 `baselineMinusFineMs`는 정상 차이로 보존한다. 원본 표본과 모든 파생 백분위를 재계산해 대조한다. AWS는 사용하지 않았으며 #19는 열린 상태다.
