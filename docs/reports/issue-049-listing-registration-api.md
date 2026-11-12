# [Issue #49] 상품·경매 등록 API·멱등성 구현 보고서

- 상태: 완료
- 작성일: 2026-11-12
- 관련 사양: [상품 등록·이미지 업로드](../specs/issue-046-listing-registration.md)

## 흐름

```text
POST /api/v1/listings
  → X-Actor-Id에서 판매자 식별
  → (sellerId, Idempotency-Key) 조회
  → 동일 Hash면 기존 결과 반환 / 다른 Hash면 충돌
  → products/{sellerId}/{uploadId} HEAD 검증
  → 순수 Product·Auction 규칙 검증
  → Product + Auction + Image + Idempotency + Outbox 단일 Transaction 저장
```

## 구현 경계

- `ListingRegistrationService`는 Repository·ObjectStorage Port에만 의존한다.
- 현재 시각과 UUID 생성은 Controller가 전달한다. Domain은 시스템 시각이나 외부 SDK를 읽지 않는다.
- `JdbcListingRegistrationRepository`가 `TransactionTemplate` 안에서 모든 영속 Row를 저장한다. 중간 실패면 Transaction 전체가 Rollback된다.
- 로컬 개발에서만 `X-Actor-Id`를 사용한다. Cognito 전환 시 Controller의 인증 Adapter만 교체한다.

## 멱등성 정책

| 요청 | 결과 |
|---|---|
| 같은 판매자·Key·본문 | 저장 없이 최초 Product/Auction 결과 반환 |
| 같은 판매자·Key·다른 본문 | `IdempotencyConflictException` |
| 다른 판매자·같은 Key | 별도 요청 |

`listing_idempotency`의 복합 기본 키가 동시 요청에서도 판매자별 Key 중복을 막는다.

## 검증

- RED: Use Case·Port가 없는 상태에서 Application Test 컴파일 실패
- GREEN: 멱등 재시도·본문 충돌·타인 업로드·Outbox 생성 Application Test 통과
- `:runtime:test --rerun-tasks` 통과: 로컬 PostgreSQL에 Flyway V1/V2 적용, Spring Context·Hikari DataSource·Storage Bean 조립 확인
