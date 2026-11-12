# [Issue #45] 상품·경매 도메인 경계 테스트 보고서

- 상태: 완료
- 작성일: 2026-11-12
- 관련 사양: [상품·경매 데이터 모델](../specs/issue-042-listing-auction-data-model.md)
- 관련 Issue: [#45 도메인 경계값 테스트](https://github.com/dev-baek/bidflow/issues/45), [#44 상태 전이 구현](https://github.com/dev-baek/bidflow/issues/44)

## TDD 증적

1. `ListingAuctionRulesTest`를 먼저 추가했다.
2. Domain 모델이 없는 상태에서 `:domain:test`는 필요한 Symbol을 찾지 못해 실패했다(RED).
3. 외부 의존성 없는 Record와 순수 함수만 추가했다.
4. 같은 Test가 통과했다(GREEN).

## 검증한 경계

| 규칙 | 정상 경계 | 거절 경계 |
|---|---|---|
| 상품 입력 | 제목 2자, 설명 10자, 이미지 1장 | 빈 제목·카테고리, 설명 9자, 이미지 0장 |
| 경매 생성 | 1,000원, 시작까지 정확히 10분, 기간 정확히 10분 | 999원, 시작까지 9분 59초, 기간 9분 59초, 14일 초과 |
| 상태 전이 | `now == startsAt`에서 활성화, `now == endsAt`에서 종료 | 각각 1ms 전에는 전이 거절 |
| 취소 | 소유자가 시작 전 취소 | 타인 취소, 시작 시각과 같은 순간의 취소 |
| 자동 연장 | 승인 시 4분 59초 남으면 기존 종료 시각 + 5분 | 정확히 5분, 거절·중복 처리면 연장 없음 |

## 구현 경계

- Domain은 `Instant.now()`, Spring, Repository, Kafka, Redis를 참조하지 않는다.
- `now`, `actorId`, 서버 생성 UUID는 외부 Adapter 또는 Application이 전달한다.
- 각 상태 변경은 원본 Record를 변경하지 않고 새 `Auction`을 반환하며 버전을 1 증가시킨다.
- 이전 Issue 설명의 `OPEN`, `CLOSED` 명칭 대신 승인된 #42 사양의 `ACTIVE`, `ENDED`를 사용한다.
