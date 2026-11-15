# [Issue #63] PostgreSQL 단순 조회와 OpenSearch 검색 비교

- 작업 완료일: 2026-11-15
- Issue: [#63 PostgreSQL 검색 대비 OpenSearch 품질·성능 비교](https://github.com/dev-baek/bidflow/issues/63)
- 사양: [issue-010-search-api-ui.md](../specs/issue-010-search-api-ui.md)
- Fixture: [`tests/fixtures/search-comparison.sql`](../../tests/fixtures/search-comparison.sql)

## 1. 목적

이 비교는 PostgreSQL을 검색 API의 fallback으로 채택하기 위한 것이 아니다. 동일한 공개 상품 Fixture에서 PostgreSQL의 단순 `LIKE` 조회와 OpenSearch의 `match` 조회가 같은 결과를 반환하는지 확인하고, 작은 로컬 환경의 응답시간을 참고값으로 남긴다.

검색 API는 계속 OpenSearch read Alias만 사용한다. PostgreSQL은 상품·경매의 원본과 재색인 입력이고, OpenSearch는 Filter·정렬·Cursor를 제공하는 파생 읽기 모델이다.

## 2. 환경과 Fixture

| 항목 | 값 |
|---|---|
| 실행 환경 | Apple Silicon 로컬 Docker Compose |
| PostgreSQL | 17.5 Alpine |
| OpenSearch | 2.19.2, 단일 노드, 1 shard / 0 replica |
| Fixture | `benchmark-seller`의 공개·활성 상품 100건 |
| 검색어 | `Camera` |
| 기대 결과 | `Camera` 제목 50건, `Chair` 제목 50건 제외 |
| 측정 횟수 | 워밍업 후 20회, P95는 nearest-rank(19번째) |

Fixture는 `benchmark-seller`로 격리한다. 재실행 시 해당 판매자의 경매·상품만 삭제한 뒤 같은 100건을 다시 넣으므로 일반 개발 데이터와 섞이지 않는다.

## 3. 측정 경로

| 대상 | 요청 |
|---|---|
| PostgreSQL | 공개·활성 상품에서 `lower(title) like '%camera%'` 단순 조회, `EXPLAIN ANALYZE` 실행 시간 |
| OpenSearch | `bidflow-products-read` Alias에서 `searchable=true`, `sellerId=benchmark-seller` Filter와 제목 `match` Query |

OpenSearch 문서는 Spring Boot의 `/api/internal/search/reindex`를 통해 PostgreSQL 원본에서 재생성했다. 재색인 결과는 기존 로컬 상품 1건을 포함해 101건이었고, 비교 대상 Fixture는 별도로 100건으로 고정했다.

## 4. 결과

| 검증 | PostgreSQL | OpenSearch | 결과 |
|---|---:|---:|---|
| `Camera` 결과 수 | 50 | 50 | 일치 |
| 반환 `productId` 집합 차이 | - | 0건 | 일치 |
| P50 응답시간 | 0.176 ms | 12.025 ms | 참고값 |
| P95 응답시간 | 0.229 ms | 18.009 ms | 참고값 |

### 해석

100건의 작은 Fixture에서는 PostgreSQL 단순 조회가 더 짧게 측정됐다. 이는 조인·`LIKE` Query와 OpenSearch HTTP 요청을 같은 조건의 성능 벤치마크로 취급할 수 없고, 데이터가 작아 PostgreSQL index·full-text·동시 부하의 차이도 나타나지 않기 때문이다.

따라서 이 결과로 “OpenSearch가 더 빠르다”고 주장하지 않는다. BidFlow에서 OpenSearch를 쓰는 이유는 제목 전문 검색과 다중 Filter·정렬·`search_after` Cursor를 원본 거래 DB에서 분리하고, Kafka 이벤트와 PostgreSQL Snapshot으로 재색인 가능한 읽기 Projection을 만들기 위해서다. 단순 조건 조회만 남는다면 PostgreSQL 조회로 단순화하는 것이 더 적절하다.

## 5. 재현 절차

```sh
make local-up-search

docker compose --env-file .env.example -f infra/local/compose.yaml \
  exec -T postgres psql -U bidflow -d bidflow -v ON_ERROR_STOP=1 \
  -f /dev/stdin < tests/fixtures/search-comparison.sql

SPRING_PROFILES_ACTIVE=local ./backend/gradlew --no-daemon -p backend :runtime:bootRun

curl -X POST -H 'X-Actor-Id: benchmark-admin' \
  'http://127.0.0.1:8080/api/internal/search/reindex?pageSize=100'
curl -X POST 'http://127.0.0.1:9200/bidflow-products-read/_refresh'
```

이후 두 결과의 `productId` 집합과 각 20회 실행 시간을 비교한다. 검색 문법·필터·정렬을 변경하거나 데이터량을 늘린 경우에는 이전 수치를 재사용하지 않고 새 환경 정보와 함께 다시 기록한다.

## 6. 검증 증적

- 로컬 Compose의 PostgreSQL·Kafka·Redis·SeaweedFS·OpenSearch Health 확인
- Spring Boot local profile 기동 및 Flyway v7 적용
- OpenSearch reindex `indexedCount: 101`
- PostgreSQL 50건, OpenSearch 50건, `productId` diff 0건
- 검색 요청 유효성은 `SearchListingsServiceTest`, 색인 문서 직렬화는 `OpenSearchProductDocumentWriterTest`에서 단위 검증
