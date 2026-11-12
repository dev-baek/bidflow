# [Issue #55] OpenSearch 상품 색인·재처리 사양

- 상태: 제안됨
- 작성일: 2026-11-12
- 관련 Issue: [#55 OpenSearch 매핑·색인·재처리 사양 작성](https://github.com/dev-baek/bidflow/issues/55)
- 후속 작업: #56 인덱스 매핑, #57 Kafka Search Indexer, #58 전체 재색인, #59 검색 API·화면
- 선행 결정: [OpenSearch 파생 데이터 전략 ADR](./issue-027-opensearch-derived-data-adr.md), [Kafka 이벤트 계약](./issue-008-event-contract.md)

## 1. 목적과 경계

상품 검색은 제목 전문 검색, 카테고리·상태·가격·마감 시간 Filter, 정렬을 제공해야 한다. PostgreSQL의 `product`, `auction`이 유일한 원본이며 OpenSearch는 언제든 다시 만들 수 있는 읽기 Projection이다. 따라서 OpenSearch 지연·장애·문서 유실은 상품 등록과 입찰 Transaction을 실패시키지 않는다.

색인 Worker는 `listing-event`를 독립 Consumer Group `search-projection`으로 소비한다. HTTP 등록 Controller와 Outbox Publisher는 OpenSearch API를 직접 호출하지 않는다.

## 2. S. 검색 화면 계약

초기 검색 화면은 다음 입력과 결과를 제공한다. 상세 화면, 자동완성, 오타 교정은 범위 밖이다.

| 화면 요소 | API Query | 동작 |
|---|---|---|
| 검색어 | `q` | `title` 전문 검색. 빈 값이면 Filter·정렬 결과만 조회 |
| 카테고리 | `categoryId` | 정확히 일치하는 항목만 반환 |
| 상태 | `status` | `SCHEDULED`, `ACTIVE`만 선택 가능 |
| 가격 | `minPrice`, `maxPrice` | `currentPrice` 범위 Filter |
| 마감 임박 | `endsBefore` | `endsAt`이 지정 시각 이전인 항목만 반환 |
| 정렬 | `sort` | `RELEVANCE`, `ENDING_SOON`, `PRICE_ASC`, `PRICE_DESC`, `NEWEST` |

- 검색 결과에는 `productId`, `title`, `categoryId`, `thumbnailObjectKey`, `currentPrice`, `status`, `endsAt`을 표시한다.
- 항상 `searchable=true`만 반환한다. 비공개·종료·삭제 상태는 원본과 운영 이력에는 남아도 검색 목록에는 노출하지 않는다.
- 검색 인덱스가 불가용하면 API는 `SEARCH_UNAVAILABLE`(HTTP 503)을 반환한다. PostgreSQL 부분 검색으로 대체하지 않는다.

## 3. D. 인덱스와 문서 모델

### 3.1 인덱스 이름과 Alias

| 용도 | 이름 | 접근 주체 |
|---|---|---|
| 물리 인덱스 | `bidflow-products-v{N}` | Indexer·재색인 명령만 직접 접근 |
| 읽기 Alias | `bidflow-products-read` | 검색 API만 접근 |
| 쓰기 Alias | `bidflow-products-write` | Kafka Indexer만 접근 |

처음에는 `v1`에 읽기·쓰기 Alias 모두 연결한다. Mapping 또는 Analyzer 변경은 새 `v{N+1}`을 만들고 PostgreSQL 원본으로 채운 뒤, 하나의 Alias API 요청으로 read/write Alias를 함께 전환한다. Alias 변경은 원자적이므로 클라이언트가 의도하지 않은 인덱스를 보는 순간이 없다. [OpenSearch Alias 문서](https://docs.opensearch.org/latest/im-plugin/index-alias/)

### 3.2 `bidflow-products-v1` Mapping

```json
{
  "settings": {
    "number_of_shards": 1,
    "number_of_replicas": 0,
    "analysis": {
      "normalizer": {
        "lowercase_normalizer": { "type": "custom", "filter": ["lowercase"] }
      }
    }
  },
  "mappings": {
    "dynamic": "strict",
    "properties": {
      "productId":          { "type": "keyword" },
      "sellerId":           { "type": "keyword" },
      "title":              { "type": "text", "analyzer": "standard", "fields": { "sort": { "type": "keyword", "normalizer": "lowercase_normalizer", "ignore_above": 256 } } },
      "categoryId":         { "type": "keyword" },
      "conditionGrade":     { "type": "keyword" },
      "thumbnailObjectKey": { "type": "keyword", "index": false },
      "startingPrice":      { "type": "long" },
      "currentPrice":       { "type": "long" },
      "status":             { "type": "keyword" },
      "startsAt":           { "type": "date" },
      "endsAt":             { "type": "date" },
      "searchable":         { "type": "boolean" },
      "listingVersion":     { "type": "long" },
      "auctionVersion":     { "type": "long" },
      "indexedAt":          { "type": "date" }
    }
  }
}
```

| 필드 | 출처 | 색인 이유 |
|---|---|---|
| `productId` | Product PK | 문서 ID·이벤트 멱등 Upsert 기준 |
| `sellerId` | Product | 운영 점검 및 후속 판매자 Filter. 공개 검색 Filter에는 사용하지 않음 |
| `title` | Product | 한글·영문 공백 단위의 기본 전문 검색과 제목 정렬 |
| `categoryId`, `conditionGrade`, `status` | Product·Auction | 정확 Filter |
| `startingPrice`, `currentPrice` | Auction | 금액 Filter·정렬. 최소 화폐 단위 `long` 유지 |
| `startsAt`, `endsAt` | Auction | 노출 시점·마감 임박 Filter·정렬 |
| `thumbnailObjectKey` | ProductImage 첫 번째 이미지 | 결과 썸네일 조회. Object Storage URL은 저장하지 않음 |
| `searchable` | Projection 정책 | 검색 제외는 물리 삭제 대신 표시 상태로 관리 |
| `listingVersion`, `auctionVersion` | 원본 version | 순서가 뒤섞인 Event가 최신 문서를 덮어쓰지 않게 함 |
| `indexedAt` | Worker Clock | Projection 지연과 재색인 관측 |

`standard` Analyzer는 별도 플러그인 없이 한글·영문 제목의 기본 검색을 제공한다. 동의어, 형태소 분해, 자동완성이 실제 검색 품질 측정에서 필요하다고 확인되면 새 Analyzer와 새 물리 인덱스를 만들고 Alias 전환으로 적용한다. 기존 인덱스의 Analyzer를 즉석 변경하지 않는다.

로컬은 1 primary shard·0 replica를 사용한다. AWS 검증 환경의 shard·replica 수는 문서 수, 검색 지연, 장애 허용 요구와 비용을 측정한 뒤 별도 결정한다.

## 4. B. Event Projection 동작

### 4.1 Consumer 공통 규칙

1. `search-projection` Group이 `listing-event`를 소비한다.
2. Envelope, `schemaVersion`, Topic·Key·필수 payload를 #54 계약 검증기로 확인한다.
3. `(consumer_group, event_id)`가 처리 완료면 OpenSearch 쓰기와 Offset Commit을 건너뛴다.
4. 문서 Upsert 또는 상태 갱신을 성공시킨 뒤 처리 기록을 PostgreSQL에 저장한다.
5. 처리 기록 Transaction이 성공한 뒤 Offset을 Commit한다.

Kafka는 At-least-once이므로 OpenSearch의 같은 `productId` Upsert는 여러 번 실행될 수 있다. 문서 ID를 `productId`로 고정하고 version 비교를 사용해 결과를 멱등화한다. Consumer 멱등 테이블·재시도/격리는 #85에서 구현한다.

### 4.2 이벤트별 Projection

| 이벤트 | 색인 동작 | version 조건 |
|---|---|---|
| `ListingPublished` | `productId` 문서를 생성 또는 갱신하고 `searchable=true` | 전달 `listingVersion`이 저장 값보다 크거나 같을 때만 반영 |
| `ListingUpdated` | 제목·카테고리 등 변경 필드를 갱신 | 동일 조건 |
| `ListingUnpublished` | `searchable=false`, `listingVersion` 갱신 | 동일 조건 |
| `AuctionExtended` | `endsAt`, `auctionVersion` 갱신 | 전달 `auctionVersion`이 저장 값보다 크거나 같을 때만 반영 |
| `AuctionEnded` | `status`를 종료 상태로, `searchable=false`, 최종 가격 반영 | 동일 조건 |

`ListingPublished` Event에 없는 Auction·이미지 상세 필드는 Worker가 PostgreSQL 원본 조회로 보강한다. Event payload 자체를 검색 문서의 영구 원본으로 취급하지 않는다. 이 선택은 계약을 작게 유지하면서 재색인 시에도 동일한 `Product + Auction + 첫 이미지` Projection을 만들기 위함이다.

OpenSearch Upsert가 실패하면 예외를 전파하고 Offset·처리 기록을 완료하지 않는다. 재시도 한도와 격리 Topic은 #84/#85에서 확정한다. 이 실패는 등록 API나 입찰 처리에 전파되지 않는다.

## 5. I. 재색인과 운영 절차

### 5.1 전체 재색인

전체 재색인은 Event 보존 기간에 의존하지 않고 PostgreSQL 원본을 페이지 단위로 읽는다.

1. `bidflow-products-v{N+1}`과 Mapping을 생성한다.
2. `Product + Auction + 첫 ProductImage`를 `productId` 오름차순 keyset pagination으로 읽는다.
3. 각 레코드를 동일 Projection 함수로 Bulk Upsert 한다.
4. 원본 대상 수와 새 인덱스 문서 수, 표본 필드·version을 비교한다.
5. 확인이 끝나면 read/write Alias를 원자적으로 새 인덱스로 전환한다.
6. 이전 인덱스는 롤백 가능 기간 동안 보존한 뒤 명시적 운영 명령으로 삭제한다.

OpenSearch는 source와 destination이 같은 재색인을 허용하지 않으므로, Mapping 변경·복구에서는 반드시 새 물리 인덱스를 사용한다. [OpenSearch 재색인 문서](https://docs.opensearch.org/latest/im-plugin/reindex-data/)

재색인 중 계속 도착하는 이벤트는 기존 write Alias에 반영될 수 있다. 따라서 Alias 전환 직전, 재색인 시작 시각 이후의 `listing-event`를 새 인덱스에도 재적용하거나 원본의 version을 마지막으로 비교한다. 이 작업은 #58에서 구현·검증한다.

### 5.2 로컬·AWS 연결 정책

| 환경 | Endpoint | 보안·운영 정책 |
|---|---|---|
| Local | `http://127.0.0.1:9200` / `make local-up-search` | Docker 개발 전용, 보안 플러그인 비활성화 |
| AWS 검증 | OpenSearch VPC Endpoint | IAM 최소 권한, TLS, 검증 종료 뒤 Terraform destroy |

로컬 인덱스는 개발 데이터로 간주한다. `make local-down`은 컨테이너만 중단하고, 인덱스를 지우는 작업은 `make local-reset` 또는 명시적 삭제 명령으로 한정한다.

## 6. T. 검증 계획

| 구분 | 정상 | 오류·경계 |
|---|---|---|
| Mapping | 모든 선언 필드가 기대 type으로 생성 | 미선언 필드 색인 시 `dynamic: strict` 실패 |
| Analyzer | 한글·영문·숫자 제목 검색 결과 반환 | 빈 검색어는 `match_all` + Filter만 적용 |
| Event | 같은 `productId` Upsert가 문서 하나만 유지 | 누락 필수 필드·Key 불일치는 Consumer가 거절 |
| Version | 최신 `listingVersion`·`auctionVersion` 반영 | 늦게 도착한 낮은 version Event는 문서를 되돌리지 않음 |
| Search Filter | `searchable=true`, 상태·가격·마감 조건 일치 | 비공개·종료 문서가 공개 결과에 노출되지 않음 |
| 장애 | OpenSearch 중단 시 등록·입찰은 성공 | Indexer는 Offset 미커밋·재시도, 검색 API는 503 |
| 재색인 | 새 인덱스 수·표본이 원본과 일치하고 Alias 전환 | 전환 전 실패 시 이전 read Alias를 유지 |

## 7. 완료 조건

- [x] S/D/B/I/T 경계와 원본·파생 데이터 책임을 명시했다.
- [x] 물리 인덱스·read/write Alias·문서 Mapping을 확정했다.
- [x] Kafka Event별 Upsert·version·실패 처리를 정의했다.
- [x] PostgreSQL 원본 기반 전체 재색인과 Alias 전환 절차를 정의했다.
- [x] 로컬 Docker와 AWS 검증 환경의 접속·운영 경계를 기록했다.
- [x] Mapping·순서 역전·장애·재색인 검증 기준을 정의했다.
