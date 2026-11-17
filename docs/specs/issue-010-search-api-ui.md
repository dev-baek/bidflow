# [Issue #59] 상품 검색 API·결과 화면 사양

- 상태: 제안됨
- 작성일: 2026-11-12
- 관련 Issue: [#59 상품 검색 API와 결과 화면 S/B/T 사양 작성](https://github.com/dev-baek/bidflow/issues/59)
- 선행 사양: [OpenSearch 상품 색인·재처리](./issue-009-search-indexer.md)
- 후속 작업: #60 검색 Query, #61 검색 결과 화면, #63 검색 품질·성능 비교
- 후속 개정: [#10 검색 상세 링크·MVP 필터 화면](https://github.com/dev-baek/bidflow/issues/10), 여정 검증 #99
- 필터 화면 개정 상태: 검토 대기. 기존 API를 사용하는 화면·테스트 변경만 대상으로 한다.

## 1. 목적과 범위

사용자는 공개 상태인 상품을 제목 검색, 카테고리·경매 상태·가격·마감 시각 Filter, 정렬로 찾는다. 검색은 `bidflow-products-read` Alias의 OpenSearch Projection만 사용하며, PostgreSQL은 검색 API의 대체 조회원이 아니다. 검색에서 말하는 상태는 물품 컨디션(`GOOD` 등)이 아니라 기존 API가 받는 **경매 상태**다.

범위에서 제외한다.

- 자동완성, 오타 교정, 동의어 사전, 형태소 품질 개선
- 판매자별 관리 목록과 종료 상품 이력 조회
- 검색 결과 카드의 원본 이미지 전달 URL 발급(현재는 placeholder)
- 물품 컨디션 필터 및 검색 API·DB 스키마·색인 변경

## 2. S. 결과 화면 사양

### 2.1 URL과 화면 상태

검색 조건은 새로고침·공유·뒤로가기에 유지되도록 URL Query로 표현한다.

```text
/listings?q=camera&categoryId=DIGITAL&status=ACTIVE&minPrice=50000&sort=ENDING_SOON
```

| 상태 | 화면 | 사용자 행동 |
|---|---|---|
| `IDLE` | 아직 검색하지 않은 기본 화면 또는 편집 중인 조건 | 검색어·Filter·정렬 변경 후 검색 |
| `LOADING` | 목록 상단 진행 표시. 다음 페이지를 조회할 때만 기존 결과 유지 | 조건 변경 가능, 같은 다음 페이지 중복 요청 불가 |
| `RESULTS` | 상품 카드, 현재 조건, 다음 결과 버튼 | 조건 변경, 다음 페이지 조회 |
| `EMPTY` | “조건에 맞는 상품이 없습니다”와 필터 초기화 | 조건 수정 또는 초기화 |
| `ERROR` | 서비스 오류 또는 조건 오류 안내 | 서비스 오류는 같은 조건으로 재시도, 조건 오류는 입력 수정 |

기존 화면의 **검색 버튼/Enter 제출**을 유지한다. 입력 중에는 요청하거나 URL을 갱신하지 않고, 제출이 성공적으로 검증되면 검색 조건을 URL에 반영해 첫 페이지를 조회한다. debounce와 필터별 자동 요청은 이번 범위에서 제외한다. 조건이 들어 있는 URL로 접속하거나 새로고침·뒤로가기/앞으로가기로 돌아오면 해당 조건의 첫 페이지를 다시 조회한다. Query 없는 `/listings`와 필터 초기화는 기본 대기 화면이다. 필터 없이 검색 버튼을 누른 경우는 `?sort=RELEVANCE`로 기록하여 대기 화면과 구분한다.

편집으로 조건이 바뀌면 기존 목록·Cursor를 비우고 앞선 응답은 무시한다. 다음 페이지는 마지막으로 조회한 조건과 같은 경우에만 `nextCursor`로 요청하고 응답을 이어 붙인다. 같은 조회가 진행 중이면 다음 페이지 조회를 다시 보내지 않는다. Cursor를 URL에 저장하지 않는다. 서비스 오류에서 다시 시도하면 직전에 실패한 첫 페이지 또는 다음 페이지 요청을 같은 조건으로 실행한다.

### 2.2 입력과 표시 규칙

| 요소 | 값·제약 | 표시 규칙 |
|---|---|---|
| 검색어 `q` | 공백 제거 0~100자 | 빈 값은 전체 공개 상품 Filter 검색 |
| 카테고리 | `DIGITAL`, `FASHION`, `HOBBY`, `LIVING` 또는 미지정 | 하나만 선택 |
| 상태 | `SCHEDULED`, `ACTIVE` 또는 미지정 | 종료·취소 상태는 선택·반환 불가 |
| 가격 | 최소/최대(원), 각각 선택 사항. 0 이상 정수, 서버 `Long` 범위 | 0은 유효값, 빈칸은 조건 없음. 양쪽 값이 있으면 `minPrice <= maxPrice`, 두 경계 포함 |
| 마감 시각 | 선택 사항. `마감 시각 이전 (UTC)` 입력의 값을 UTC Instant로 변환 | 지정 시 `endsAt <= endsBefore`. 브라우저 시간대 기준으로 해석하지 않음 |
| 정렬 | 관련도·마감 임박·낮은 가격·높은 가격·최근 공개 시작순 | 최근 공개 시작순은 `NEWEST`(`startsAt DESC`), 등록 생성 시간순이 아님 |

결과에는 기존 제목·현재가·경매 상태와 함께 응답에 있는 카테고리와 마감 시각을 표시한다. `thumbnailObjectKey`는 API 응답에 유지하지만 이 작업에서 이미지 표시를 새로 구현하지 않는다. 검색 결과가 `searchable=false`이거나 `ENDED`/`CANCELLED`인 경우 Browser에 전달하지 않는다.

경매 ID가 있는 결과의 제목을 키보드로도 열 수 있는 내부 링크로 표시한다. 링크는 `/auctions/{auctionId}`로 이동하며, 전체 페이지를 새로 불러오지 않아 로그인 상태를 보존한다. 기존 색인 문서에 경매 ID가 없으면 결과를 버리지 않고 제목만 표시한다. 상품 ID로 경매 경로를 추측하지 않는다.

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

`cursor`는 Base64URL로 인코딩한 정렬값과 `productId`의 내부 표현이다. 클라이언트는 해석·조작하지 않고 API가 준 값을 그대로 보낸다. Filter·정렬 fingerprint가 맞지 않거나 형식이 잘못된 Cursor는 현재 구현에서 `400 INVALID_SEARCH_QUERY`로 응답한다.

### 3.2 응답

```json
{
  "items": [
    {
      "productId": "f4b33d2e-6e54-4d61-a57c-48f3d3f28de0",
      "auctionId": "a045614c-8c21-4eb1-a209-49689dc0d8b1",
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

`auctionId`는 새로 색인한 문서에 있는 공개 경매 UUID다. 보강 전 기존 문서는 `null`을 반환한다. `productId`는 문서 ID·정렬·Cursor 기준으로 남는다.

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

- `q`가 있으면 `title`에 `match` Query를 넣는다. `q`가 없으면 제목 조건을 추가하지 않는다.
- category·status는 `term`, 가격·마감 시각은 `range` Filter를 사용한다.
- 정렬 필드와 `productId`를 `search_after`에 함께 사용한다. Offset 기반 `from + size` deep pagination은 사용하지 않는다.
- 응답 `_source`에서 문서 모델의 공개 결과 필드만 매핑한다. `sellerId`, version, `indexedAt`은 반환하지 않는다.

### 4.2 HTTP 오류

| 상황 | HTTP | 코드 | Browser 동작 |
|---|---:|---|---|
| Query 형식·범위 오류 | 400 | 앱의 Query 검증은 `INVALID_SEARCH_QUERY`; 프레임워크 입력 변환 오류는 같은 응답 코드를 가정하지 않음 | 조건 오류를 서비스 장애와 구분. 잘못된 가격·마감 등은 브라우저에서 먼저 차단 |
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

- URL ↔ 검색 조건 변환, 유효성 검사, 요청 응답에 따른 상태 전이는 순수 함수로 테스트한다. 라우터·fetch는 화면 효과 경계에 둔다. 앞선 요청의 늦은 성공·실패를 최신 조회에 반영하지 않는다. 공유 API 클라이언트 계약은 변경하지 않는다.
- Backend Query Adapter는 `bidflow-products-read` Alias만 읽는다. 물리 인덱스명과 write Alias를 참조하지 않는다.
- Query 결과는 Projection 지연을 가질 수 있다. 등록 직후의 강한 일관성은 보장하지 않는다. 경매 ID 추가와 기존 문서 보강 순서는 [색인 사양 §5.3](./issue-009-search-indexer.md)을 따른다.

## 6. T. 검증 계획

| 대상 | 정상 | 오류·경계 |
|---|---|---|
| Query 변환 | q·Filter·정렬이 올바른 DSL·Alias로 변환 | 빈 q, 최대 size, min=max, 모든 sort |
| Filter 강제 | searchable·공개 상태 문서만 반환 | `searchable=false`, `ENDED`, `CANCELLED` 제외 |
| Cursor | 다음 페이지에 중복·누락 없이 이어짐 | Filter 변경·위조·손상 Cursor는 400 |
| 정렬 | 각 sort와 `productId` tie-breaker 일치 | 같은 가격·마감·점수에서 순서 안정 |
| API 오류 | OpenSearch timeout은 503 코드 반환 | PostgreSQL fallback 호출 없음 |
| UI Reducer·Query | 조건 직렬화/역직렬화, 입력 변경 시 Cursor 초기화, Loading/Results/Empty 전환 | 0·같은 최소/최대 허용, 음수·소수·최소/최대 역전·잘못된 UTC 날짜는 요청 금지. 이전 요청의 늦은 성공·실패 무시 |
| React 화면 | 빈 검색어로 필터 검색, 복합 조건·`NEWEST` 전달, 다음 페이지 이어 붙이기 | 빈 결과·잘못된 조건·503을 구분, 같은 조건 재시도, 뒤로가기/새로고침 복원, 초기화 |
| 접근성 | 검색어·Filter Label, 로딩과 오류 안내 | 키보드로 입력·검색·상세 링크·다음 결과 버튼 사용 |
| 상세 링크 | 색인→검색 응답의 `auctionId`가 상세 경로와 일치 | 기존 문서는 제목만 표시, 상품 ID로 대체하지 않음 |

기존 [#99 인수 테스트](../reports/issue-099-playwright-e2e.md)는 등록 상품을 찾고 실제 경매 상세로 이동한다. 후속 구현은 React/순수 함수 실패 테스트부터 추가한다. 로컬 OpenSearch 인수 검증에서는 공통 검색 토큰을 가진 고유 테스트 상품을 준비하고, 조건에 맞는 두 상품의 **순서**와 조건 밖 상품의 **제외**를 화면에서 확인한다. 색인은 제한된 폴링으로 기다리고, 필터 결과의 상세 링크 계약을 유지한다. OpenSearch를 사용하지 않은 실행은 로컬 검색 인수 검증으로 집계하지 않는다. 기존 검색 대안 비교는 [#63 보고서](../reports/issue-063-search-comparison.md)를 사용한다.

## 7. 완료 조건

- [x] S/D/B/I/T 계약과 제외 범위를 기록했다.
- [x] URL Query, Filter, 정렬, Cursor·응답 형식을 확정했다.
- [x] OpenSearch read Alias·강제 Filter·search_after 경계를 확정했다.
- [x] 빈 결과, 입력 오류, 검색 장애의 Browser 동작을 정의했다.
- [x] Backend·Frontend 단위/통합/E2E 검증 기준을 정의했다.
