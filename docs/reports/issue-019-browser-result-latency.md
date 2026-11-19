# [Issue #19] 브라우저 결과 관측 P95 — 2초 기준 미달

- 사양: [브라우저 지연 관측](../specs/issue-019-browser-result-latency.md)
- 본 실행 소스: `73d029aed316cd48c3f2eceafe52e100d724c47d`
- 실행일: 2026-11-19, 로컬 Chromium `145.0.7632.6`, Node 24, Java 21.0.7, Spring Boot `local,e2e`와 Vite. Docker PostgreSQL·Kafka·Redis·SeaweedFS·OpenSearch 사용.
- **기능은 완료됐지만 지연 목표는 실패했다.** 2초 임계값이나 표본을 수정해서 통과시키지 않았다.

## 관측 방법

실제 이미지 PUT과 등록 API로 새 상품·경매를 만들고, 두 독립 브라우저 context가 공개·개인 토픽을 구독한 뒤 시작했다. 서버 Clock은 마감 10분 전으로 고정했다. 두 사용자가 11,000원부터 30,000원까지 번갈아 20건을 순차 제출했다.

금액 입력 후 이전 승인 안내가 사라진 것을 확인하고, 클릭 호출 직전부터 Node runner의 단조 시계로 관측했다. 해당 POST가 반환한 새 requestId와 개인 frame의 requestId·auctionId·가격·승인/최고입찰자 상태를 맞췄다. 개인 안내와 **두 화면의 새 공개 현재가**까지 확인한 뒤 표본을 완료했다. 응답보다 먼저 온 frame도 클릭 전 수집을 시작해 보존했다.

## 결과

| 지표 | 사전 smoke | 소스 고정 본 실행 |
|---|---:|---:|
| 완료 / 미완료 | 20 / 0 | 20 / 0 |
| 클릭 → 접수 본문 관측 P95 | 79.80ms | 61.52ms |
| 클릭 → 해당 개인 frame 관측 P95 | 2,063.54ms | 2,077.14ms |
| 클릭 → 양쪽 화면·개인 안내 확인 P50 | 1,939.66ms | 1,938.27ms |
| 클릭 → 양쪽 화면·개인 안내 확인 P95 | **2,935.97ms** | **2,938.43ms** |
| 같은 화면 지표 P99 | 2,936.54ms | 2,947.08ms |
| 2초 기준 | 실패 | 실패 |

두 회차는 별개 Fixture이며 표본을 합치지 않았다. smoke는 `58e23cd` 기반 작업 트리의 측정 코드, 본 실행은 commit을 고정한 코드다. 본 실행을 포함한 전체 Playwright 결과는 **기능 E2E 5개 통과, 지연 기준 E2E 1개 실패**였다. 실패 회차도 20건을 모두 수집한 뒤 nearest-rank P95로 판정했다.

이 값은 Playwright actionability·runner 전달·assertion polling을 포함한 **관측 상한**이다. 실제 브라우저 paint 시각의 P95가 2.94초라고 단정하지 않는다. 기존 DB 관측 P95 1,245.38ms는 다른 전송 시작점·동시성·Fixture에서 수집한 수치이므로 빼서 구간별 비용을 계산하지 않는다.

## 정합성 보조 확인

[SQL 집계](evidence/issue-019-browser-latency-db.json)에서 두 시험 경매 모두 요청 20건·승인 원장 20건·서로 다른 원장 requestId 20개·정산 결과 Outbox 20건이었다. 승인 가격은 이벤트의 `auctionVersion` 순서에서 역행 0건이고 최종가 30,000원·승자가 최신 승인 이벤트와 일치했다.

서버 Clock이 고정돼 `decided_at`이 모두 같으므로 가격 순서를 랜덤 원장 UUID로 정렬하지 않았다. `BidAccepted.payload.auctionVersion`을 기준으로 확인했다. 본 실행의 공개 상세는 `ACTIVE / 30000 / version 21`을 확인했다. smoke 경매는 후속 전체 E2E의 Clock 진행으로 종료돼 SQL 사후 집계에서는 `ENDED / version 22`였으나, 측정 시점의 공개 상세 단언은 `ACTIVE / version 21`을 통과했다.

원본:

- [본 실행 표본](evidence/issue-019-browser-latency.json)
- [smoke 표본](evidence/issue-019-browser-latency-smoke.json)
- [경매별 SQL 집계](evidence/issue-019-browser-latency-db.json)

## 재현

기존 [로컬 E2E 실행 전제](issue-099-playwright-e2e.md)에 따라 `local,e2e` API와 Vite를 띄운 뒤 `apps/web`에서 실행한다. 지연 플래그가 없으면 이 사례는 건너뛰며 실측 성공으로 세지 않는다.

```sh
BIDFLOW_E2E_BASE_URL=http://127.0.0.1:5173 BIDFLOW_E2E_LATENCY=1 \
  npm run test:e2e -- --workers=1 --grep '순차 입찰 20건'
```

성공·실패 모두 `test-results`의 `browser-result-latency.json`과 첨부 파일을 남긴다. 실패 trace/screenshot은 기존 Playwright 정책에 따른다. 원본 frame·Token·이미지 URL은 JSON 증적에 넣지 않는다.

## 다음 점검과 한계

Outbox Scheduler의 기본 지연은 1초다. 요청 발행과 정산 결과 발행이 이 경계를 거치므로 후보 지연 구간이다. 동시에 `expect.poll`의 대기 간격과 화면 단언 대기가 관측 상한을 늘릴 수 있다. 둘을 분리 계측하지 않아 **원인 확정이나 생산 코드 최적화는 하지 않았다**. 다음 단계에서 관측 해상도와 발행 대기를 분리한다.

후속: [동일 요청의 기본·25ms 관측 비교](issue-019-paired-browser-observation.md)에서 관측 대기 차이를 확인했다. 기본 기준 실패는 유지하며, Outbox 대기 시간의 직접 계측은 아직 남아 있다.

순차 20건의 로컬 직접 입찰만 관측했다. 동시 부하·재연결·장애·자동입찰·AWS P95는 검증하지 않았다. #19는 목표 미달 상태로 열린 채 유지한다.

기존 Vite 캐시의 일부 디렉터리가 root 소유라 기본 서버 기동 시 권한 오류가 났다. 기존 파일을 삭제하거나 권한을 바꾸지 않고 임시 외부 cacheDir로 실행했다. 테스트 뒤 API는 기본 `local` 프로필로 되돌렸으며 서비스·합성 데이터는 보존했다.
