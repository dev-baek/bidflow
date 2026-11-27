# [Issue #102] BidFlow 검증 결과와 회고

- 관련: [#102 결과·회고](https://github.com/dev-baek/bidflow/issues/102) · [#21 포트폴리오 Epic](https://github.com/dev-baek/bidflow/issues/21) · [포트폴리오 사양](../specs/issue-021-portfolio-docs.md)
- 기존 증적을 종합한 회고다. 수치는 Apple Silicon MacBook의 로컬 환경에서 얻었으며, 이번 문서 변경으로 앱이나 AWS를 새로 실행한 것은 아니다.

## 문제와 설계

마감 직전에 여러 입찰이 들어와도 경매에는 하나의 현재가와 낙찰 결과만 남아야 한다. 같은 요청을 다시 보내도 원장이 늘면 안 되고, 검색이나 실시간 알림의 실패가 입찰 원장을 막아서도 안 된다.

API는 PostgreSQL에 입찰 요청과 Outbox를 함께 저장한 뒤 `202 RECEIVED`로 **접수**를 알린다. Kafka는 같은 경매의 명령을 같은 파티션에 전달하고, Redis Lua는 활성 경매 가격과 승자를 원자적으로 계산한다. **확정 결과의 기준은 PostgreSQL 원장**이며, 검색·실시간 전파는 별도 소비 경로다. 이 설계는 접수와 승인 사이에 대기 상태가 생기는 대신, 정산과 파생 기능에 서로 다른 복구 경계를 둔다. 기술 대안과 비용 비교는 [#97 Kafka 검증](issue-097-kafka-performance-cost.md)에 있다.

## 시연: 마감 1분 전 두 사용자가 자동 입찰하면

1. 판매자가 이미지와 경매를 등록하고, 구매자가 검색 결과에서 경매 상세를 연다.
2. 두 사용자가 각각 자동 최대가 30,000원과 20,000원을 제출한다. 최대가는 상대에게 공개되지 않는다. 두 화면의 공개 현재가는 21,000원으로 수렴하고, 첫 승인 입찰로 기존 마감 12:30 UTC가 12:35 UTC로 연장된다.
3. 원래 마감에 대조 경매는 종료되지만 대상 경매는 계속 진행된다. 연장 마감에 두 화면이 새로고침 없이 공개 낙찰가 21,000원을 표시하고, 개인 영역은 낙찰·패찰·비참여를 구분한다. 종료 뒤 새 입찰은 접수될 수 있지만 정산은 `AUCTION_ENDED`로 거절하며 공개 결과는 바뀌지 않는다.

재현: [#99 Browser 실행 절차와 전체 시나리오](issue-099-playwright-e2e.md). 기존 로컬 실행 기록: [검색 → 상세 #234](https://github.com/dev-baek/bidflow/pull/234) · [연장 → 종료 #229](https://github.com/dev-baek/bidflow/pull/229) · [종료 후 거절 #236](https://github.com/dev-baek/bidflow/pull/236) · [개인 결과 #240](https://github.com/dev-baek/bidflow/pull/240). 위 시연 순서는 여러 테스트를 묶은 것이며, [README 화면](../../README.md#핵심-시연과-결과)은 그중 로컬 자동입찰 시나리오의 낙찰·패찰 캡처다. [자동 연장 테스트](issue-104-auction-extension.md)는 정확히 5분 남았을 때와 같은 요청을 재실행했을 때 연장하지 않는 경계도 다룬다.

2026년 11월 27일 [경매 마켓 통합 검증](issue-376-marketplace-ui-regression.md)에서는 등록한 JPEG의 목록·상세 표시부터 같은 경매의 12,000원 직접 입찰과 본인 낙찰까지 확인했다. 실제 로컬 서비스 기능 5개와 별도 Chromium 화면 5개, Cognito 대역 2개가 통과했다. 화면 확인용 시각·사진은 테스트 예시이며 운영 데이터와 AWS는 사용하지 않았다.

2026년 11월 22일 [이전 기능 회귀](issue-020-local-functional-regression.md)의 SQL 교차 검사는 별도 증적이다. 새 경매 8개의 요청/원장/입찰 결과는 각각 8개(승인 7·종료 후 거절 1), 미처리·중복 0개였고 경매 결과와 AuctionEnded 3개를 대조했다. 이 수치를 최신 UI 실행의 결과로 합산하지 않는다.

## 측정 결과: 무엇을 증명했나

| 검증 | 결과 | 범위 |
|---|---|---|
| [동일 경매 어댑터 통합 테스트 #76](https://github.com/dev-baek/bidflow/pull/149) | Redis Lua에 서로 다른 입찰 1,000건: 승인 순서의 가격 증가 및 최종 승자 일치. PostgreSQL에 동일 요청 정산 1,000건: 원장·이벤트 Outbox 각 1건. | Redis·PostgreSQL Testcontainers로 각각 검증. HTTP 1,000건 동시 실측이 아님. |
| [집중 HTTP 부하](issue-019-focused-load-baseline.md) | 단일 경매, 20건 모두 접수. 접수 P50/P95/P99 **75.09 / 78.14 / 78.65ms**, 처리 시작 P95 **886.47ms**. 승인 1건·거절 19건, 미처리·중복 원장 0건. | Lag는 전·후 0, 중간 피크 미측정. 승인 표본 1건이라 가격 단조성의 증거로 쓰지 않음. |
| [분산 HTTP 부하](issue-019-distributed-load-baseline.md) | 6경매, 20 VU 2분 유지, 2,535건 접수·HTTP 실패 0건. 접수 P50/P95/P99 **12.77 / 41.88 / 105.65ms**, 처리 시작 P95 **1,338.53ms**. 미처리·중복 원장 0건. Lag 최대 관측 10건. | 종료 약 2.04초 뒤 첫 사후 조회에서 Lag 0. 파티션 1에 약 67%가 유입됐지만 병목 원인까지 측정하지는 않음. |
| [단일 경매 누적 1,000건 HTTP](issue-019-instrumented-rerun.md) | 20 VU × 50회. 요청/원장/결과 각각 1,000개, 승인 207·정상 거절 793·미처리 0. 접수 P50/P95/P99 **17.73 / 290.48 / 713.15ms**, HTTP 오류율 0%. 명령 40개 모두 성공, DLT 불변, 관측 Lag 최대 합계 241 → 최종 0. | local/100ms·공유 Mac 한 번의 결과. 1,000건 전체 동시 HTTP가 아니다. P95 기준 여유는 약 9.52ms. 부하 종료 관측 약 9.67초 뒤 최종 SQL/Lag 0을 확인했지만 정확한 커밋/회복 시각은 아님. |
| [별도 정산 대기 관측](issue-019-settlement-wait-live.md) | 20 VU × 50회. HTTP 접수·계측 1,000/1,000, 접수 P95 **165.66ms**, 오류율 0%. 확인용 정산 SELECT는 서버의 4초 제한에 걸려 전체 검증 미통과. | 같은 요청의 원장·두 화면 대조와 후속 Lag/DLT는 미완료. 활성 표본 39개 중 I/O 1개로는 원인이나 대기 시간을 확정할 수 없음. |

`202`는 입찰 승인과 다르다. 처리 시작 지표는 서버의 요청 기록부터 Consumer 처리 시작까지이며, **최종 DB 커밋·WebSocket 전달 시간은 포함하지 않는다.** 각 부하의 패턴이 다르므로 P95를 서로 비교해 개선율이나 처리량 한계로 해석하지 않는다.

누적 1,000건의 [첫 시도](issue-019-focused-load-collector.md)는 585건 접수 후 관측 오류로 중단됐다. 뒤이은 진단·명령 추적 보완 후 별도 smoke와 본 실행이 통과했지만, 배경 상태와 관측 SQL/수집기가 달라 인과적 개선율을 제시할 수 없다. 실패 시점의 불완전한 관측은 그대로 보존했고 정확한 중단 원인은 미확정이다. 결과가 좋아진 것과 원인을 설명할 수 있는 것은 별개다.

[두 사용자 동시 관측](issue-019-concurrent-snapshot-fix.md)은 두 건씩 10회/총 20건의 개인 결과와 양쪽 화면 수렴 P95 443.33ms를 기록했다. 이 값은 브라우저 assertion polling 등을 포함하는 별도 지표이며, 위 1,000건 접수 지연과 합쳐 “1,000건의 WebSocket 전달 P95 2초”로 주장하지 않는다.

## 장애에서 배운 것

| 증적 | 실패와 회복 | 회고 |
|---|---|---|
| [정산 Consumer 중단](issue-096-settlement-consumer-recovery.md) | API·검색은 유지됐다. 입찰 3건이 접수됐지만 원장은 없었고 Lag는 0 → 3 → 0. 재시작 뒤 3건이 중복 없이 정산되고 최종가 15,000원으로 수렴했다. | 접수와 최종 상태를 분리하고, 재시작 뒤 커밋되지 않은 명령을 이어받았다. 과거 오프셋 되감기와는 다른 검증이다. |
| [Redis 중단](issue-096-redis-recovery.md) | 일시 중단 중 새 입찰은 대기하고 기존 공개가 12,000원을 유지했다. 재시작 뒤 현재가·원장·Redis가 13,000원으로 일치했다. | Redis의 짧은 중단과 복구를 검증했다. Redis 데이터 유실·재구성은 별도의 [Snapshot 복구 통합 테스트](issue-086-redis-auction-recovery.md) 범위다. |
| [OpenSearch 중단](issue-096-opensearch-recovery.md) | 검색만 `503`, 등록·입찰은 유지됐다. 검색 Lag가 0이어도 DLT로 이동한 이벤트의 문서는 누락됐고, PostgreSQL 재색인으로 복구했다. | Lag는 처리 성공이 아니다. DLT 유입·색인 성공 기록·실제 검색 결과를 함께 확인해야 한다. |
| [직접 입찰 재시도 #235](https://github.com/dev-baek/bidflow/pull/235) | 같은 사용자의 **새** 입찰과 **같은 요청의 재시도**를 폼에서 구분하도록 수정했다. | 재시도에는 키를 유지하고, 확정 후 새 입찰에는 새 키를 발급한다. 서버 멱등성만 맞아도 UI가 요청 의도를 잘못 표현하면 사용자 흐름은 깨진다. |

## AWS 준비와 남은 검증

| 구분 | 확인한 것 | 확인하지 않은 것 |
|---|---|---|
| 로컬 실행 | Browser E2E, 부하·장애 재현, 원장과 파생 상태 비교 | 1,000건 동시 HTTP, 장시간 포화·장애, 최종 결과 전달 P95 |
| Cognito 대역 | [로컬 Chromium](../specs/issue-005-cognito-frontend.md#로컬-chromium-재현)에서 두 시나리오를 두 번씩 통과. PKCE·토큰 전달 경계·401 연결 종료 확인 | 실제 User Pool, 배포된 로그인 도메인·CORS·WebSocket |
| AWS 설계·정적 검증 | [Terraform 구성](../../infra/terraform/README.md), [Runbook](../specs/issue-017-aws-deployment.md), 기존 [Budget #175](https://github.com/dev-baek/bidflow/pull/175)·[OpenSearch 런타임 #212](https://github.com/dev-baek/bidflow/pull/212) PR의 `terraform validate`·계약 테스트 기록 | AWS 계정에서의 Plan·Apply, 실서비스 연결 및 비용 |
| 실제 AWS 검증 | 미실행. [#97 비용 예시](issue-097-kafka-performance-cost.md#aws-요금-예시--실측-청구액-아님)는 공개 요금과 가정만 사용 | 10만 원 전체 예산 적합성, 실제 배포·Smoke Test·청구·Destroy 결과 |

제한된 브라우저/DB 관측과 누적 1,000건 접수 검증은 확보했지만, 1,000건 전체 동시 HTTP와 그 조건의 최종 WebSocket 전달 지연은 여전히 미검증이다. 정확한 DB 커밋·서버 내부 구간 병목도 기존 관측으로 단정하지 않는다. 추가 대규모 실험은 자동으로 확대하지 않고 별도 사양으로 결정한다. AWS 검증은 별도 승인과 전체 비용 검토 뒤, [#91 Smoke Test·Destroy](https://github.com/dev-baek/bidflow/issues/91)에서 동일 흐름과 잔여 리소스를 확인한다.

면접에서는 “Kafka를 써서 빨라졌다”보다 “접수와 정산을 분리했고, 지연·장애 뒤에도 원장 결과가 일치하는지 검증했다”고 설명한다. 특히 **Lag 0인데 검색 결과가 누락된 사례**는 기술 선택뿐 아니라 무엇을 운영 지표로 봐야 하는지 보여준다.
