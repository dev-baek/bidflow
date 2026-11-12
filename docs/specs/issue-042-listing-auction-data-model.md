# [Issue #42] 상품·경매 데이터 모델과 상태 전이 사양

- 상태: 제안됨
- 작성일: 2026-11-12
- 상위 Epic: [#6 종합 중고 상품과 경매 데이터 모델 설계](https://github.com/dev-baek/bidflow/issues/6)
- 작업 Issue: [#42 상품·경매 데이터 모델과 상태 전이 사양 작성](https://github.com/dev-baek/bidflow/issues/42)
- 선행 사양: [프로젝트 범위](./issue-001-project-scope.md), [이벤트 계약](./issue-008-event-contract.md)
- 후속 작업: #43 테이블·인덱스, #44 상태 전이 구현, #45 경계값 테스트, #46 등록 사양

## 1. 목적과 원칙

종합 중고 상품 정보와 시간 제한 경매를 분리해 이후 등록 API, PostgreSQL 원장, OpenSearch 색인 및 Kafka 이벤트가 같은 업무 의미를 사용하게 한다.

- `Product`는 판매할 물건의 설명과 이미지의 원본이다.
- `Auction`은 가격, 시간, 진행 상태와 낙찰 결과의 원본이다.
- 금액은 원화 최소 단위의 정수(`long`)로만 다룬다. `double`과 `BigDecimal` 문자열 표현을 계약에 사용하지 않는다.
- 시간 비교와 상태 전이는 `now`를 인자로 받는 순수 함수로 계산한다. Domain이 시스템 시각이나 데이터베이스를 직접 읽지 않는다.
- 최종 원본은 PostgreSQL이며 Redis와 OpenSearch는 이 모델에서 복구 가능한 파생 데이터다.
- 한 `Product`에는 동시에 하나의 미종료 `Auction`만 존재할 수 있다.

## S. 화면 사양

이 Issue는 화면을 구현하지 않지만, 후속 등록·상세 화면은 아래 상태와 필드를 반드시 표현한다.

| 화면 | 표시·입력 항목 | 상태 |
|---|---|---|
| 상품 등록 | 제목, 설명, 카테고리, 상태 등급, 이미지, 시작가, 시작·종료 시각 | 입력 중, 이미지 업로드 중, 검증 오류, 등록 중, 등록 완료 |
| 상품 상세 | 상품 정보, 이미지, 판매자 표시명, 경매 상태, 시작가·현재가, 시작·종료 시각 | 시작 전, 진행 중, 종료, 취소됨, 조회 실패 |
| 내 경매 | 상품 제목, 대표 이미지, 경매 상태, 종료 시각, 결과 | 예정, 진행, 종료, 취소됨, 목록 없음 |

화면은 서버가 반환한 `AuctionStatus`를 임의 문자열로 추론하지 않는다. 시간 경과에 따라 `SCHEDULED`가 `ACTIVE`로 보이는 판정은 서버 상태 조회 결과를 사용한다. 브라우저 시계는 남은 시간 표시만 위해 사용하며, 입찰 가능 여부의 최종 판단은 서버가 한다.

## D. 데이터 사양

### D.1 개념 모델

```text
User (Cognito subject)
  1 ─── N Product ─── 1 ─── N ProductImage
                │
                └── 1 ─── N Auction (동시에 미종료 상태는 최대 1개)
                                  │
                                  └── 0 ─── 1 AuctionResult
```

`User`의 인증 원본은 Cognito다. PostgreSQL은 `seller_id`와 `bidder_id`처럼 Cognito subject를 참조하는 식별자만 보관하며 비밀번호나 인증 토큰을 저장하지 않는다.

### D.2 Product

| 필드 | 타입 | 규칙 |
|---|---|---|
| `productId` | UUID | 서버 생성, 불변 |
| `sellerId` | String | 인증된 Cognito subject, 불변 |
| `title` | String | 공백 제거 후 2~100자 |
| `description` | String | 공백 제거 후 10~5,000자 |
| `categoryId` | String | 서버가 허용한 카테고리 코드, 공백 불가 |
| `conditionGrade` | Enum | `NEW`, `LIKE_NEW`, `GOOD`, `FAIR`, `POOR` 중 하나 |
| `status` | Enum | `PUBLISHED`, `UNPUBLISHED` |
| `version` | long | 1부터 시작하는 낙관적 잠금 버전 |
| `createdAt`, `updatedAt` | Instant | 서버가 기록하는 UTC 시각 |

`Product`는 경매를 만들 때 이미 `PUBLISHED` 상태여야 한다. `UNPUBLISHED` 상품은 검색에서 제거되며 새 경매를 만들 수 없다. 이미 진행 중이거나 종료된 경매의 상품은 이 MVP에서 `UNPUBLISHED`로 바꾸지 않는다. 이 제한으로 구매자가 참여 중인 경매가 상품 정보와 함께 사라지는 일을 막는다.

### D.3 ProductImage

| 필드 | 타입 | 규칙 |
|---|---|---|
| `imageId` | UUID | 서버 생성, 불변 |
| `productId` | UUID | Product 소유자와 동일한 판매자만 변경 가능 |
| `objectKey` | String | S3 object key만 저장, 공개 URL·Presigned URL은 저장하지 않음 |
| `displayOrder` | int | 0부터 연속, Product 안에서 유일 |
| `altText` | String | 선택, 최대 200자 |

이미지는 1장 이상 10장 이하이고 첫 번째(`displayOrder = 0`)가 대표 이미지다. S3 업로드 검증과 Presigned URL 정책은 #46·#47에서 구체화한다.

### D.4 Auction

| 필드 | 타입 | 규칙 |
|---|---|---|
| `auctionId` | UUID | 서버 생성, 불변 |
| `productId` | UUID | `Product` 1개에 연결, 불변 |
| `sellerId` | String | Product의 `sellerId`를 복사해 조회 비용을 낮춤; 생성 뒤 불변 |
| `status` | Enum | 아래 상태 모델 준수 |
| `startingPrice` | long | 1,000 이상, 원화 최소 단위 |
| `currentPrice` | long | 생성 시 `startingPrice`; 활성 입찰 처리만 변경 |
| `startsAt` | Instant | UTC; 등록 시각보다 최소 10분 뒤 |
| `endsAt` | Instant | `startsAt`보다 최소 10분, 최대 14일 뒤; 자동 연장으로만 이후 변경 가능 |
| `version` | long | 1부터 시작하는 낙관적 잠금 버전 |
| `createdAt`, `updatedAt` | Instant | 서버 기록 UTC 시각 |

`currentPrice`는 입찰 엔진의 승인 결과를 PostgreSQL 원장에 반영한 값이다. 실시간 계산 중 Redis 값과 잠시 다를 수 있으나, 복구와 종료 판정은 PostgreSQL에 확정된 값과 입찰 원장을 기준으로 한다.

### D.5 AuctionResult

| 필드 | 타입 | 규칙 |
|---|---|---|
| `auctionId` | UUID | Auction과 1:1, 기본 키 |
| `outcome` | Enum | `SOLD` 또는 `UNSOLD` |
| `winnerId` | String | `SOLD`면 필수, `UNSOLD`면 `null` |
| `finalPrice` | long | `SOLD`면 `startingPrice` 이상, `UNSOLD`면 `null` |
| `determinedAt` | Instant | 종료 Worker가 최초 확정한 UTC 시각 |

결과는 한 번 생성되면 변경하지 않는다. 재실행된 종료 Worker는 기존 결과를 반환하며 두 번째 결과나 이벤트를 만들지 않는다.

### D.6 상태 모델과 전이

| 상태 | 의미 | 허용 전이 |
|---|---|---|
| `SCHEDULED` | 등록 완료, 시작 시각 전 | `ACTIVE`, `CANCELLED` |
| `ACTIVE` | 입찰을 받을 수 있는 기간 | `ENDED` |
| `ENDED` | 종료·낙찰/유찰이 확정됨 | 없음 |
| `CANCELLED` | 판매자가 시작 전 취소함 | 없음 |

```text
SCHEDULED --(now >= startsAt)--> ACTIVE --(now >= endsAt, 종료 확정)--> ENDED
    │
    └--(판매자 취소, 시작 전)--> CANCELLED
```

- `SCHEDULED → ACTIVE`는 `now >= startsAt`일 때의 순수 시간 판정이다. Scheduler 또는 상태 조회 Use Case가 저장소에 반영할 수 있다.
- `ACTIVE → ENDED`는 `now >= endsAt`와 PostgreSQL 잠금 획득이 모두 필요하다. 상태만 바꾸지 않고 `AuctionResult`와 Outbox를 같은 Transaction으로 기록한다.
- 판매자는 `SCHEDULED`인 자신의 경매만 취소할 수 있다. `startsAt` 이상인 취소 요청은 거절한다.
- `ENDED`, `CANCELLED` 상태의 가격·기간·상품 연결은 변경할 수 없다.
- 시작·종료 시각은 항상 UTC `Instant`로 저장·전달한다. 화면은 사용자 시간대로 변환해 표시한다.

### D.7 기간과 자동 연장

승인된 입찰에만 다음 순수 규칙을 적용한다.

```text
remaining = endsAt - approvedAt
if remaining < 5 minutes:
  nextEndsAt = endsAt + 5 minutes
else:
  nextEndsAt = endsAt
```

- 정확히 5분 남은 경우는 연장하지 않는다.
- 거절되거나 이미 처리한 `bidRequestId`의 재수신은 연장하지 않는다.
- 연장 횟수에는 상한을 두지 않는다.
- `endsAt` 변경은 `Auction.version`을 조건으로 하는 갱신으로 한 번만 반영한다.
- `AuctionExtended`에는 변경 전·후 `endsAt`과 갱신 후 버전을 기록한다.

## B. 백엔드 사양

### B.1 Domain 입력·출력

Domain은 아래와 같은 값과 순수 결과만 다룬다. Repository, `Clock`, Kafka, Redis, Spring Annotation은 Domain에 둘 수 없다.

| 순수 함수 | 입력 | 결과 |
|---|---|---|
| `validateProduct` | Product 생성 값 | 유효 Product 또는 필드별 오류 |
| `createAuction` | Product 상태, Auction 생성 값, `now` | Auction 또는 생성 거절 사유 |
| `transitionAuction` | Auction, `now`, 전이 요청 | 변경된 Auction 또는 전이 거절 사유 |
| `extendEndsAtAfterAcceptedBid` | Auction, 승인 시각 | 변경된 Auction과 연장 여부 |
| `determineOutcome` | Auction, 최종 유효 입찰, `now` | AuctionResult 또는 종료 거절 사유 |

`now`, UUID, 인증 사용자 정보는 Imperative Shell이 전달한다. 결과 오류는 예외 메시지 문자열이 아니라 안정적인 코드로 표현한다.

| 오류 코드 | HTTP 후보 | 의미 |
|---|---:|---|
| `INVALID_PRODUCT_FIELD` | 400 | 제목·설명·카테고리·이미지 조건 위반 |
| `INVALID_AUCTION_PERIOD` | 400 | 시작·종료 시각 또는 기간 범위 위반 |
| `INVALID_STARTING_PRICE` | 400 | 시작가 범위 위반 |
| `PRODUCT_NOT_PUBLISHED` | 409 | 경매 생성 불가능한 상품 상태 |
| `ACTIVE_AUCTION_EXISTS` | 409 | 같은 상품의 미종료 경매 존재 |
| `ILLEGAL_AUCTION_TRANSITION` | 409 | 현재 상태에서 허용되지 않은 전이 |
| `AUCTION_VERSION_CONFLICT` | 409 | 낙관적 잠금 충돌; 최신 상태 재조회 필요 |

입찰 가격 단위와 자동 입찰 승자 계산은 #62·#64·#65에서 확정한다. 이 문서는 그 결과가 `ACTIVE` 경매의 `currentPrice`와 `AuctionResult`에 반영된다는 경계만 정의한다.

### B.2 명령·조회와 소유권

| 동작 | 인증·소유권 | 변경 |
|---|---|---|
| 상품·경매 등록 | 인증된 판매자 | Product, Image, Auction, Outbox를 함께 생성 |
| 상품 상세 조회 | 공개 | 없음 |
| 경매 상태 조회 | 공개 | 필요 시 `SCHEDULED → ACTIVE` 전이 반영 |
| 시작 전 취소 | `sellerId` 일치 | `SCHEDULED → CANCELLED`, Outbox 생성 |
| 종료 확정 | Scheduler 전용 | `ACTIVE → ENDED`, Result·Outbox를 함께 생성 |

등록 Transaction은 Product, ProductImage, Auction 및 `ListingPublished` Outbox를 모두 성공시키거나 모두 실패시킨다. HTTP Controller는 입력 변환과 Use Case 호출만 담당한다.

### B.3 이벤트 경계

이 사양은 기존 [이벤트 계약](./issue-008-event-contract.md)을 따른다.

| 업무 사실 | Topic / Event | Key | 발생 조건 |
|---|---|---|---|
| 상품·경매 공개 | `listing-event` / `ListingPublished` | `productId` | 등록 Transaction 확정 뒤 Outbox 발행 |
| 상품 정보 수정 | `listing-event` / `ListingUpdated` | `productId` | 후속 수정 기능의 Transaction 확정 뒤 |
| 시작 전 취소·비공개 | `listing-event` / `ListingUnpublished` | `productId` | 취소 또는 비공개 처리 확정 뒤 |
| 경매 종료 | `bid-event` / `AuctionEnded` | `auctionId` | Result와 종료 상태가 확정된 뒤 |

`ListingPublished`는 상품의 검색 가능 상태를 알리고, 입찰 가능 여부를 직접 보장하지 않는다. 입찰 Worker는 항상 PostgreSQL의 `Auction.status`와 `endsAt`을 최종 확인한다.

## I. 로컬 실행·저장 정책

- PostgreSQL이 Product·Image·Auction·Result와 Outbox의 최종 원본을 보관한다.
- 로컬 Docker의 PostgreSQL은 `POSTGRES_PORT=15432`로 노출된다. Host의 다른 PostgreSQL을 사용하지 않는다.
- 로컬 Redis는 활성 `ACTIVE` 경매의 계산 상태만 보관하며, 이 사양의 영구 엔터티를 대체하지 않는다.
- OpenSearch 문서는 `Product`와 `Auction`의 `PUBLISHED`·`SCHEDULED`·`ACTIVE` 정보를 Projection한 검색용 복사본이다.
- Kafka Topic은 로컬 Compose가 생성한 `listing-event`, `bid-command`, `bid-event`만 사용한다. Domain 모델은 Kafka Client를 참조하지 않는다.
- 다음 #43에서 PostgreSQL DDL, 제약·부분 유니크 인덱스, 조회 인덱스와 Migration 도구를 구현한다.

## T. 인수·경계 테스트 사양

후속 #45는 아래 표를 Domain 단위 테스트로 먼저 실패시키고, 구현 후 통과시킨다.

| 대상 | 정상 | 오류·경계 |
|---|---|---|
| Product 검증 | 공백 제거 뒤 제목 2자·설명 10자·이미지 1장 수락 | 빈 제목, 101자 제목, 9자 설명, 이미지 0장·11장 거절 |
| Auction 생성 | 1,000원·시작 10분 뒤·기간 10분 수락 | 999원, 시작 시각 과거, 정확히 10분 미만 기간, 14일 초과 거절 |
| 시간 전이 | `now == startsAt`에서 `ACTIVE`, `now == endsAt`에서 종료 가능 | 시작 전 `ACTIVE` 전이, 종료 전 `ENDED` 전이 거절 |
| 취소 | 시작 전 판매자 취소 수락 | 타인 취소, `now == startsAt` 취소, `ACTIVE` 취소 거절 |
| 자동 연장 | 4분 59초 남은 승인 입찰은 기존 종료 시각 + 5분 | 정확히 5분, 거절 입찰, 중복 입찰은 미연장 |
| 결과 확정 | 마지막 유효 입찰이 있으면 `SOLD`, 없으면 `UNSOLD` | `ACTIVE`가 아니거나 종료 전 확정 거절, 이미 Result 있으면 새 Result 미생성 |
| 순수성 | 같은 입력은 같은 결과 | 시스템 시각·UUID·Repository·Spring Context 없이 테스트 실행 |

통합 테스트는 #43 이후 PostgreSQL 제약으로도 확인한다. 특히 같은 Product에 `SCHEDULED` 또는 `ACTIVE` Auction을 두 개 만들려는 Transaction은 하나만 성공해야 한다.

## 2. 완료 조건

- [x] Product, Image, Auction, Result의 책임과 영구 원본 경계가 정의됐다.
- [x] 가격·기간·동시 경매 제약과 상태 전이가 정의됐다.
- [x] 자동 연장 5분 경계와 재처리 규칙이 정의됐다.
- [x] S/D/B/I/T 구분, 소유권, 이벤트와 테스트 인수 조건이 기록됐다.
- [x] 후속 #43·#44·#45·#46의 구현 경계가 분리됐다.
