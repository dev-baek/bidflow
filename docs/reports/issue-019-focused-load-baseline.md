# [Issue #19] 로컬 집중 입찰 부하 기준선

- 실측일: 2026-11-16
- 이슈: [#19 부하·장애 검증](https://github.com/dev-baek/bidflow/issues/19)
- 대상: `4e5e507688fcdbbf84598f806d3f0ebaa9670541`, Spring Boot Java 21.0.7, `local` 프로필(실제 시계)
- 환경: Apple Silicon Mac15,12, macOS 26.5.1, 호스트 8 CPU·16 GiB. Docker Engine 27.5.1, Docker 8 vCPU·약 7.65 GiB. PostgreSQL·Kafka·Redis·SeaweedFS·OpenSearch 실행 상태.
- 입력: k6 0.54.0, `local20261116f01`, 로컬 합성 경매 `8a0e4ab9-96fe-409d-a8a1-07857f8a84d8`. 20 VU가 한 경매에 각 1회, 모두 20,000원 직접 입찰(시작가 10,000원).

## 결과

| 관측 항목 | 결과 |
|---|---:|
| HTTP 접수 P50 / P95 / P99 | 75.09 / 78.14 / 78.65 ms |
| HTTP 실패율 / 접수 | 0% / 20건의 `202 RECEIVED` |
| 서버 요청 기록 → Kafka Consumer 처리 시각 P50 / P95 / P99 | 840.50 / 886.47 / 889.16 ms |
| 최종 판정 | 승인 1건, `BID_TOO_LOW` 거절 19건, 미처리 0건 |
| 원장 | 요청 20건·원장 20건, 중복 0건 |
| 경매 상태 | 현재가 20,000원, 마지막 승인 원장과 낙찰 후보 일치 |
| Kafka `bid-settlement` Lag | 시작 전·종료 후 조회 모두 3개 파티션에서 0 |

승인과 잘못 혼동하기 쉬운 항목은 접수 성공률이다. 모두 접수됐지만 첫 20,000원 이후에는 최소 호가를 충족하지 못한 19건이 정상 거절됐다. 승인 가격 역행은 0건이지만 승인 표본이 1건이라 여러 상승 거래에서의 단조성을 입증하지는 않는다.

Lag 측정에서 `bid-command` 파티션 1의 로그 끝과 Consumer offset은 둘 다 25 → 45였다. 피크 Lag나 0 회복에 걸린 시간은 연속 관측하지 않았다. DB의 `processed_at - requested_at`은 처리 시작까지의 서버 기록 차이다. 커밋 완료 시각이나 브라우저 최종 결과 전달 시간으로 해석하지 않는다. 이 한 번의 20건 집중 실행은 지속 처리량·1,000건 HTTP 내구성·AWS 성능 기준이 아니다.

증적: [k6 원본 JSON](evidence/issue-019-focused-k6.json) · [SQL 집계 JSON](evidence/issue-019-focused-sql.json).

## 재현

1. 루트에서 `make local-up`으로 로컬 의존성을 준비하고, Java 21에서 `SPRING_PROFILES_ACTIVE=local ./backend/gradlew -p backend :runtime:bootRun`으로 API를 띄운다. Docker의 `host.docker.internal:8080`에서 접속 가능한 로컬 API만 대상으로 한다. 같은 프로필에서 다른 부하와 E2E를 동시에 돌리지 않는다. 위 실측에는 이미 실행 중이던 OpenSearch도 켜져 있었다.
2. 로컬 PostgreSQL에 새 상품·경매 UUID로 아래 Fixture를 만든다. `psql`에는 `-v product_id=...` 및 `-v auction_id=...`를 전달한다. 기존 데이터는 갱신·삭제하지 않는다.

```sql
BEGIN;
INSERT INTO product (product_id, seller_id, title, description, category_id, condition_grade, status, version, created_at, updated_at)
VALUES (:'product_id', 'load-fixture-seller', 'load-focused baseline', 'Local load measurement fixture', 'DIGITAL', 'GOOD', 'PUBLISHED', 1, now(), now());
INSERT INTO auction (auction_id, product_id, seller_id, status, starting_price, current_price, starts_at, ends_at, version, created_at, updated_at)
VALUES (:'auction_id', :'product_id', 'load-fixture-seller', 'ACTIVE', 10000, 10000, now() - interval '1 minute', now() + interval '30 minutes', 1, now(), now());
COMMIT;
```

3. 실행 전후에 `BIDFLOW_CONSUMER_GROUP=bid-settlement make consumer-lag`를 각각 실행한다. P99가 포함된 원본을 생성하려면 새 경매 UUID를 `auction_id`에, 새 실행 ID를 `run_id`에 설정한 뒤 기존 집중 시나리오를 실행한다.

```sh
result_dir=$(mktemp -d)
mkdir -p "$result_dir/reports/k6"
docker run --rm -i --user "$(id -u):$(id -g)" -v "$PWD/tests/load:/scenarios:ro" -v "$result_dir:/results" -w /results \
  -e BIDFLOW_BASE_URL=http://host.docker.internal:8080 -e BIDFLOW_LOAD_SCENARIO=focused -e "BIDFLOW_AUCTION_ID=${auction_id:?}" \
  -e "BIDFLOW_RUN_ID=${run_id:?}" -e BIDFLOW_BID_AMOUNT=20000 grafana/k6:0.54.0 run \
  --summary-trend-stats 'med,p(95),p(99),max' /scenarios/bid-request.js
```

4. 실행 범위의 요청·처리 시각과 원장을 아래 기준으로 집계한다. `request_prefix`에는 `load-<실행-ID>-focused-%`를 바인딩한다.

```sql
WITH measured AS (
  SELECT bid_request_id, status, EXTRACT(epoch FROM processed_at - requested_at) * 1000 AS ms
    FROM bid_request WHERE auction_id = :'auction_id' AND idempotency_key LIKE :'request_prefix'
)
SELECT count(*) AS requests, count(*) FILTER (WHERE status = 'RECEIVED') AS pending,
       count(*) FILTER (WHERE status = 'ACCEPTED') AS accepted,
       count(*) FILTER (WHERE status = 'REJECTED') AS rejected,
       percentile_cont(ARRAY[0.50, 0.95, 0.99]) WITHIN GROUP (ORDER BY ms) AS settlement_ms
  FROM measured;
```

해당 요청 ID만 `bid_ledger`에 조인해 거절 사유·중복 요청 ID를 집계하고, 승인 원장의 `decided_at, bid_ledger_id` 순으로 이전 가격과 비교한다. 마지막 승인 원장의 가격·입찰자가 경매 행의 현재가·최고 입찰자와 일치하는지 별도로 확인한다.

## 남은 작업

- 분산 부하, 지속 처리량, 피크 Lag와 회복 시간, 실제 최종 결과 전달 지연은 아직 측정하지 않았다.
- 장애 주입은 #96, 기술 선택·비용 비교 해석은 #97에 남긴다. AWS 리소스는 사용하지 않았다.
