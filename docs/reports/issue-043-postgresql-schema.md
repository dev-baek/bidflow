# [Issue #43] PostgreSQL 스키마·접근 패턴 검증 보고서

- 상태: 구현 중
- 작성일: 2026-11-12
- 관련 사양: [상품·경매 데이터 모델](../specs/issue-042-listing-auction-data-model.md)
- 관련 Issue: [#43 PostgreSQL 테이블·인덱스·접근 패턴 설계](https://github.com/dev-baek/bidflow/issues/43)

## 1. ERD

```text
product 1 ─── N product_image
   │
   └── 1 ─── N auction 1 ─── 0..1 auction_result
                      │
                      ├── N bid_request 1 ─── 0..1 bid_ledger
                      └── N outbox_event (aggregate_id로 연결)
```

`outbox_event`는 여러 Aggregate의 이벤트를 기록하므로 의도적으로 FK를 두지 않는다. 업무 Transaction에서 Aggregate 변경과 Outbox Insert를 함께 수행하며, FK가 없는 Outbox는 Publisher가 실패한 이벤트도 독립적으로 재처리할 수 있게 한다.

## 2. DB가 보장하는 규칙

| 규칙 | 구현 |
|---|---|
| 금액은 최소 1,000원 | `starting_price`, `current_price`, 입찰 금액의 `CHECK` |
| 현재가는 시작가보다 작지 않음 | `current_price >= starting_price` |
| 종료는 시작 이후 | `ends_at > starts_at` |
| 상품당 동시 미종료 경매 최대 1개 | `SCHEDULED`, `ACTIVE`에 대한 부분 유니크 인덱스 |
| 종료 결과는 경매당 한 번 | `auction_result.auction_id` 기본 키 |
| 동일 입찰 요청의 원장 중복 금지 | `bid_ledger.bid_request_id` 유니크 |
| Outbox 계약 최소 형태 | Topic·Schema Version·JSON Object·발행 횟수 `CHECK` |

등록 시각에서 시작 시각까지 최소 10분, 최초 기간 최대 14일 같은 규칙은 현재 시각이 필요한 Domain 규칙이라 DB `CHECK`가 아닌 순수 도메인 테스트(#45)에서 보장한다. 자동 연장은 최대 기간을 넘어설 수 있으므로 `ends_at - starts_at <= 14일` 제약도 두지 않는다.

## 3. 주요 접근 패턴과 인덱스

| 접근 패턴 | SQL 조건·정렬 | 인덱스 |
|---|---|---|
| 판매자의 경매 목록 | `seller_id`, `status`, `ends_at` | `ix_auction_seller_status_ends_at` |
| 종료 대상 획득 | `status = 'ACTIVE' and ends_at <= :now`, `ends_at` 정렬 | `ix_auction_active_ends_at` 부분 인덱스 |
| 경매별 입찰 이력 | `auction_id`, `requested_at` | `ix_bid_request_auction_requested_at` |
| 미발행 Event 전송 | `published_at is null`, `occurred_at` 정렬 | `ix_outbox_unpublished_occurred_at` 부분 인덱스 |

종료 Worker는 다음 Query를 사용한다. 여러 Worker가 같은 Row를 기다리지 않고, 이미 잠긴 Row를 건너뛴다.

```sql
select auction_id
from auction
where status = 'ACTIVE' and ends_at <= :now
order by ends_at
for update skip locked
limit :batch_size;
```

## 4. Migration과 Testcontainers 범위

- Flyway `V1__create_listing_auction_schema.sql`이 빈 PostgreSQL에 스키마를 생성한다.
- Testcontainers PostgreSQL 17.5에서 매 Test class마다 Flyway를 실행한다.
- 통합 테스트는 필수 테이블 생성, 부분 유니크 인덱스, 금액·기간 제약, `FOR UPDATE SKIP LOCKED` Query를 실제 SQL로 검증한다.
- Docker가 없는 환경에서는 Testcontainers Test가 Skip될 수 있으므로 CI에서는 Docker Runner를 사용한다.

## 5. EXPLAIN ANALYZE 기록

로컬 Docker PostgreSQL 17.5에서 다음 대표 데이터를 만든 뒤 실행했다.

- 전체 경매: 5,000건
- 종료 시각을 지난 `ACTIVE`: 500건
- 미래 종료 시각의 `ACTIVE`: 500건
- `ENDED`: 4,000건
- 조회 Batch: 100건

```text
Index Scan using ix_auction_active_ends_at on auction
  Index Cond: (ends_at <= now())
Planning Time: 0.820 ms
Execution Time: 0.133 ms
```

`FOR UPDATE SKIP LOCKED`가 포함된 Query도 `ix_auction_active_ends_at` 부분 인덱스를 사용했다. 이 수치는 로컬 Apple Silicon Docker의 단일 실행 결과이므로 절대 성능 목표가 아니라 인덱스 선택 검증 증적이다. #80 Scheduler 구현 시 실제 동시 Worker·Lock 경합 조건의 부하 결과를 별도 기록한다.
