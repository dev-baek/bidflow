# [Issue #19] 로컬 분산 입찰과 Kafka Lag 실측

- 환경: 2026-11-16, Apple Silicon Mac15,12(8 CPU·16 GiB), macOS 26.5.1, Docker Engine 27.5.1(8 vCPU·약 7.65 GiB). 기존 로컬 Compose의 PostgreSQL·Kafka·Redis·SeaweedFS·OpenSearch와 Spring Boot(Java 21.0.7, `local` 실제 시계).
- 기준 코드: `5ca2b07ee0b3d843e2754ca883b44845419c6a01` + 이 PR의 분산 시나리오 페이싱 및 20 VU 유지 구간 변경.
- k6 0.54.0, run ID `local20261116d01`. 합성 경매 6개에 시작가 10,000원·동일 직접입찰가 20,000원. 30초 동안 5 VU까지 증가, 1초 동안 20 VU까지 증가, 20 VU를 2분 유지, 10초 동안 종료. 각 VU는 응답 이후 1초 쉬며 다음 경매로 이동한다.

## 결과

| 측정 항목 | 결과 |
|---|---:|
| HTTP 요청 / 접수 / 실패 | 2,535 / 2,535 / 0건 |
| HTTP 접수 P50 / P95 / P99 | 12.77 / 41.88 / 105.65ms |
| 서버 요청 기록 → 처리 시작 P50 / P95 / P99 | 755.79 / 1,338.53 / 1,774.60ms |
| 최종 판정 | 승인 6건·거절 2,529건·미처리 0건 |
| 원장 정합성 | 2,535건, 중복 0건, 6개 경매 모두 최종가 20,000원 및 승인 원장과 최고 입찰자 일치 |
| 전체 Lag 최대 **관측값** | 10건 (파티션별 0 / 9 / 1) |
| 종료 뒤 Lag | k6 프로세스 종료 약 2.04초 후 완료된 첫 조회에서 0 |

거절은 `BID_TOO_LOW` 2,383건과 `SELF_BID` 146건이다. HTTP `202 RECEIVED`는 입찰 승인과 별개다. 승인 원장 가격의 역행은 없었으나 경매당 승인 1건이라 여러 승인 간 가격 단조성을 검증하는 시나리오는 아니다. 요청 기록→처리 시작은 DB의 시간 차이며, 커밋 완료나 브라우저 전달 지연은 측정하지 않았다.

Lag는 `bid-settlement` Consumer Group의 `bid-command` 세 파티션을 대상으로 총 34회(전 1·중 32·후 1) 기록했다. 표본 완료 간 최대 간격은 약 6.72초다. 최고 관측값 10건은 실제 최고치의 하한이고, 종료 후 2.04초는 0을 확인한 시점이지 정확한 회복 시간은 아니다. 마지막 실행 중 표본부터 이미 0이었다. 파티션별 로그 끝 증가분은 422 / 1,689 / 424로 접수 2,535건과 일치했고, 파티션 1에 약 67%가 모였다. 경매를 나눈다고 Kafka 부하가 균등해지지는 않는다.

증적: [k6 원본 JSON](evidence/issue-019-distributed-k6.json) · [SQL 집계 JSON](evidence/issue-019-distributed-sql.json) · [Lag 표본 CSV](evidence/issue-019-distributed-lag.csv).

## 재현

1. [집중 시나리오](./issue-019-focused-load-baseline.md)의 로컬 기동·Fixture 방식으로 새 경매 6개를 만든다. 실행 ID를 새로 정하고 쉼표로 연결한 UUID들을 `BIDFLOW_AUCTION_IDS`에 설정한다. 이전 경매나 원장·볼륨을 삭제하지 않는다.
2. 루트에서 `BIDFLOW_RUN_ID="$run_id" BIDFLOW_AUCTION_IDS="$auction_ids" make load-distributed`를 실행한다. P99가 포함된 원본이 필요하면 집중 보고서의 Docker 명령에 `--summary-trend-stats 'med,p(95),p(99),max'`를 유지하고 `BIDFLOW_LOAD_SCENARIO=distributed`와 `BIDFLOW_AUCTION_IDS`를 전달한다.
3. 별도 터미널에서 `BIDFLOW_CONSUMER_GROUP=bid-settlement make consumer-lag`를 실행 전·중·후 반복하고, 조회 시작·종료 시각과 세 파티션 offset/Lag를 각각 기록한다. 이번 실행은 매 조회 완료 후 3초 대기했다. CSV의 상대 시각 기준은 k6 실행 명령을 호출한 때이며, 마지막 열에 파티션 합계를 보존한다.
4. 집중 보고서와 동일한 SQL 검증을 6개 UUID와 `load-<실행-ID>-distributed-%` 키에 한정한다. 승인 가격 비교는 전체가 아닌 `PARTITION BY auction_id`로 수행한다. 최종 판정 후 원장 수·중복·경매별 현재가/최고 입찰자 일치를 확인한다.

이번 측정은 최대 20 VU의 제한된 1회 실행이다. 1,000건 동시 HTTP 입찰, 포화 처리량, AWS 성능이나 비용을 입증하지 않는다. Redis·OpenSearch·Consumer 실장애는 #96에서, Kafka 선택 및 SQS 비교 해석은 #97에서 이어간다.
