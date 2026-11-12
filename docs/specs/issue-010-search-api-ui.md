# [Issue #59] 상품 검색 API·결과 화면 사양

- 상태: 제안됨
- 작성일: 2026-11-12
- 관련 Issue: [#59 상품 검색 API와 결과 화면 S/B/T 사양 작성](https://github.com/dev-baek/bidflow/issues/59)
- 선행 사양: [OpenSearch 상품 색인·재처리](./issue-009-search-indexer.md)
- 후속 작업: #60 검색 Query, #61 검색 결과 화면, #63 검색 품질·성능 비교

## 1. 목적과 범위

사용자는 공개 상태인 상품을 제목 검색, 카테고리·경매 상태·가격·마감 시각 Filter, 정렬로 찾는다. 검색은 `bidflow-products-read` Alias의 OpenSearch Projection만 사용하며, PostgreSQL은 검색 API의 대체 조회원이 아니다.

범위에서 제외한다.

- 자동완성, 오타 교정, 동의어 사전, 형태소 품질 개선
- 판매자별 관리 목록과 종료 상품 이력 조회
- 검색 결과 카드의 원본 이미지 전달 URL 발급(현재는 placeholder)

## 2. S. 결과 화면 사양

### 2.1 URL과 화면 상태

검색 조건은 새로고침·공유·뒤로가기에 유지되도록 URL Query로 표현한다.

```text
/listings?q=camera&categoryId=DIGITAL&status=ACTIVE&minPrice=50000&sort=ENDING_SOON
```

| 상태 | 화면 | 사용자 행동 |
|---|---|---|
| `IDLE` | 기본 Filter와 빈 결과 영역 | 검색어·Filter·정렬 변경 |
| `LOADING` | 기존 결과 유지, 목록 상단 진행 표시 | 조건 변경 가능 |
| `RESULTS` | 상품 카드, 현재 조건, 다음 결과 버튼 | 조건 변경, 다음 페이지 조회 |
| `EMPTY` | “조건에 맞는 상품이 없습니다”와 Filter 초기화 | Filter 초기화 |
| `ERROR` | 검색 일시 오류와 다시 시도 버튼 | 같은 조건으로 재시도 |

검색어 입력은 300ms debounce 뒤 URL을 갱신한다. 카테고리·상태·정렬 선택과 가격 범위 확정은 즉시 갱신한다. 다음 페이지는 `nextCursor`가 있을 때만 노출하며, 조건이 하나라도 바뀌면 기존 Cursor·결과 목록을 버린다.

### 2.2 입력과 표시 규칙

| 요소 | 값·제약 | 표시 규칙 |
|---|---|---|
| 검색어 `q` | 공백 제거 0~100자 | 빈 값은 전체 공개 상품 Filter 검색 |
| 카테고리 | `DIGITAL`, `FASHION`, `HOBBY`, `LIVING` 또는 미지정 | 하나만 선택 |
| 상태 | `SCHEDULED`, `ACTIVE` 또는 미지정 | 종료·취소 상태는 선택·반환 불가 |
| 가격 | 최소 화폐 단위 정수, 0 이상 | `minPrice <= maxPrice`여야 함 |
| 마감 시각 | ISO-8601 UTC Instant | 지정 시 `endsAt <= endsBefore` |
| 정렬 | 아래 Enum | 선택값을 URL에 유지 |

결과 카드에는 제목, 카테고리, 현재가, 경매 상태, 마감 시각을 표시한다. `thumbnailObjectKey`는 API 응답에 유지하되, 이미지 전달 API가 생기기 전에는 접근 가능한 대체 이미지로 표시한다. 검색 결과가 `searchable=false`이거나 `ENDED`/`CANCELLED`인 경우 Browser에 전달하지 않는다.

## 3. D. API 데이터 계약

### 3.1 요청

```http
GET /api/v1/listings/search?q=camera&categoryId=DIGITAL&status=ACTIVE&minPrice=50000&maxPrice=200000&endsBefore=2026-11-13T00:00:00Z&sort=ENDING_SOON&size=20&cursor=opaque
```

| Query | 타입 | 기본값 | 검증 |
|---|---|---:|---|
| `q` | String | 빈 문자열 | trim 후 최대 100자 |
| `categoryId` | String | 없음 | 허용 카테고리만 |
| `status` | Enum | 없음 | `SCHEDULED`, `ACTIVE`만 |
| `minPrice`, `maxPrice` | Long | 없음 | 0 이상 정수, min ≤ max |
| `endsBefore` | Instant | 없음 | ISO-8601 UTC |
| `sort` | Enum | `RELEVANCE` | 아래 정렬값만 |
| `size` | Integer | 20 | 1~50 |
| `cursor` | opaque String | 없음 | 같은 Filter·정렬에서 받은 `nextCursor`만 |

`cursor`는 Base64URL로 인코딩한 정렬값과 `productId`의 내부 표현이다. 클라이언트는 해석·조작하지 않고 API가 준 값을 그대로 보낸다. Filter·정렬 fingerprint가 맞지 않거나 형식이 잘못된 Cursor는 `400 INVALID_CURSOR`이다.

### 3.2 응답

```json
{
  "items": [
    {
      "productId": "f4b33d2e-6e54-4d61-a57c-48f3d3f28de0",
      "title": "중고 Camera M4",
      "categoryId": "DIGITAL",
      "thumbnailObjectKey": "products/seller-1/image-1",
      "currentPrice": 55000,
      "status": "ACTIVE",
      "endsAt": "2026-11-12T01:00:00Z"
    }
  ],
  "nextCursor": "eyJmaW5nZXJwcmludCI6Ii4uLiJ9"
}
```

`items`는 요청한 정렬 순서를 유지한다. 마지막 페이지·빈 결과는 `nextCursor: null`을 반환한다. `total`은 OpenSearch count 비용과 변화 중인 Projection의 오해를 피하기 위해 반환하지 않는다.

### 3.3 정렬 계약

| `sort` | OpenSearch Sort | 동점 해소 |
|---|---|---|
| `RELEVANCE` | `_score desc` (`q`가 비어도 적용) | `productId asc` |
| `ENDING_SOON` | `endsAt asc` | `productId asc` |
| `PRICE_ASC` | `currentPrice asc` | `productId asc` |
| `PRICE_DESC` | `currentPrice desc` | `productId asc` |
| `NEWEST` | `startsAt desc` | `productId asc` |

`NEWEST`는 현재 공개를 시작한 시각(`startsAt`) 기준이다. “등록 생성 시각” 정렬 요구가 확정되면 `createdAt`을 Mapping·Projection에 추가하고 새 물리 인덱스와 Alias 전환으로 변경한다.

## 4. B. Query와 오류 처리

### 4.1 OpenSearch Query 규칙

모든 Query에는 Filter Context로 다음 조건을 강제한다.

```json
{ "term": { "searchable": true } }
```

- `q`가 있으면 `title`에 `match` Query를 넣는다. `q`가 없으면 `match_all`을 사용한다.
- category·status는 `term`, 가격·마감 시각은 `range` Filter를 사용한다.
- 정렬 필드와 `productId`를 `search_after`에 함께 사용한다. Offset 기반 `from + size` deep pagination은 사용하지 않는다.
- 응답 `_source`에서 문서 모델의 공개 결과 필드만 매핑한다. `sellerId`, version, `indexedAt`은 반환하지 않는다.

### 4.2 HTTP 오류

| 상황 | HTTP | 코드 | Browser 동작 |
|---|---:|---|---|
| Query 형식·범위 오류 | 400 | `INVALID_SEARCH_QUERY` 또는 `INVALID_CURSOR` | 해당 Filter 안내, 기존 결과 유지 |
| OpenSearch timeout·연결·5xx | 503 | `SEARCH_UNAVAILABLE` | 오류 상태와 재시도 버튼 |
| 알 수 없는 서버 오류 | 500 | `INTERNAL_ERROR` | 일반 오류 안내·재시도 |

OpenSearch 장애를 이유로 PostgreSQL `LIKE` Query로 대체하지 않는다. 서로 다른 검색 문법·정렬로 사용자를 혼란스럽게 하고 원본 Transaction DB에 부하를 전가하기 때문이다.

## 5. I. Runtime 경계

```text
Browser URL/Reducer
  → GET /api/v1/listings/search
  → Search Query Service
  → OpenSearch read Alias
  → SearchResponse
```

- Browser Reducer에는 입력값·결과·Cursor·상태만 둔다. `AbortController`, debounce timer, fetch는 효과 경계에 둔다.
- Backend Query Adapter는 `bidflow-products-read` Alias만 읽는다. 물리 인덱스명과 write Alias를 참조하지 않는다.
- Query 결과는 Projection 지연을 가질 수 있다. 등록 직후의 강한 일관성은 보장하지 않으며, 등록 성공 화면은 Product ID를 기준으로 별도 이동한다.

## 6. T. 검증 계획

| 대상 | 정상 | 오류·경계 |
|---|---|---|
| Query 변환 | q·Filter·정렬이 올바른 DSL·Alias로 변환 | 빈 q, 최대 size, min=max, 모든 sort |
| Filter 강제 | searchable·공개 상태 문서만 반환 | `searchable=false`, `ENDED`, `CANCELLED` 제외 |
| Cursor | 다음 페이지에 중복·누락 없이 이어짐 | Filter 변경·위조·손상 Cursor는 400 |
| 정렬 | 각 sort와 `productId` tie-breaker 일치 | 같은 가격·마감·점수에서 순서 안정 |
| API 오류 | OpenSearch timeout은 503 코드 반환 | PostgreSQL fallback 호출 없음 |
| UI Reducer | 입력 변경은 Cursor 초기화, Loading/Results/Empty 전환 | 이전 요청 늦은 응답 무시, 오류 재시도 |
| 접근성 | 검색어·Filter Label, 결과 수·오류 live region | 키보드로 Filter·다음 결과 버튼 사용 |

## 7. 완료 조건

- [x] S/D/B/I/T 계약과 제외 범위를 기록했다.
- [x] URL Query, Filter, 정렬, Cursor·응답 형식을 확정했다.
- [x] OpenSearch read Alias·강제 Filter·search_after 경계를 확정했다.
- [x] 빈 결과, 입력 오류, 검색 장애의 Browser 동작을 정의했다.
- [x] Backend·Frontend 단위/통합/E2E 검증 기준을 정의했다.
