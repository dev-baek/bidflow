# [Issue #213] E2E 선행: 경매 상세·입찰 화면 사양

- 관련 Issue: [#213 E2E 선행: 경매 상세·입찰 화면 사양](https://github.com/dev-baek/bidflow/issues/213)
- 상위 흐름: #20, #99
- 선행 사양: [E2E 시나리오](issue-020-e2e.md), [입찰 도메인](issue-011-bid-domain.md), [경매 종료](issue-015-auction-close.md)

## 1. 목적과 경계

현재 Browser는 등록·검색까지만 제공한다. 이 사양은 검색 결과 또는 등록 완료의 `auctionId`로 진입해, 공개 경매 상태를 확인하고 직접/자동 입찰을 접수하며, 종료 결과까지 확인하는 최소 화면과 API 계약을 정의한다.

입찰 처리의 최종 사실은 PostgreSQL 원장이고, 입찰 접수는 비동기 `202 RECEIVED`다. Redis·Kafka·WebSocket은 상태 전파와 처리 경로이며, Browser가 받은 이벤트만으로 입찰 승인이나 낙찰을 확정하지 않는다.

다음은 이 범위에서 제외한다.

- 결제·배송·판매자 채팅
- 다른 사용자의 자동입찰 최대가, 원장 전체, 내부 Consumer 상태 노출
- Browser가 시간을 보내거나 경매 종료를 직접 실행하는 기능

## 2. S. 화면·상태·접근성

### 2.1 경로와 공개 정보

| 경로 | 접근 | 표시 정보 |
|---|---|---|
| `/auctions/:auctionId` | 비로그인 조회 가능 | 제목·대표 이미지 key·현재가·상태·종료 시각·낙찰/유찰 결과 |
| `/auctions/:auctionId` 입찰 영역 | 로그인 필요 | 직접/자동 금액 입력, 접수 상태, **본인의** 요청 결과 |

상세 화면은 REST Snapshot을 최초 상태와 재연결 보정의 기준으로 삼는다. 화면은 다음 상태를 명확히 구분한다.

| 상태 | 화면 동작 |
|---|---|
| 로딩 | `경매 정보를 불러오는 중입니다` 상태 메시지 |
| 활성(`ACTIVE`) | 현재가·종료 시각과 입찰 폼 표시 |
| 접수 중 | 제출 버튼 비활성화, `입찰 요청을 접수했습니다`와 `bidRequestId` 표시 |
| 종료(`ENDED`) | 폼 제거, `SOLD` 또는 `UNSOLD`와 최종가 표시 |
| 없음 | 404 안내, 입찰 폼 없음 |
| 조회/접수 실패 | 오류를 `role="alert"`로 표시하고 마지막 유효 Snapshot은 유지 |

`currentPrice`, `endsAt`, `status`, `auctionVersion`은 공개 정보다. 최고 입찰자 식별자와 자동입찰 최대가는 공개 화면·공개 WebSocket·검색 결과에 절대 포함하지 않는다. 종료된 뒤 본인에게만 표시하는 낙찰/패찰은 [#227 개인 결과 사양](./issue-227-private-auction-outcome.md)에서 다룬다. 공개 상세는 낙찰자 식별자를 표시하지 않는다.

### 2.2 Browser 상태 전이

상태 reducer는 순수 함수로 유지한다. 입력 이벤트는 `SNAPSHOT_LOADED`, `BID_REQUESTED`, `BID_RECEIVED`, `BID_FAILED`, `REALTIME_RECEIVED`다.

1. 최초 Snapshot이 `ACTIVE`이면 입찰을 허용한다.
2. 첫 제출은 `Idempotency-Key`를 생성한다. 접수 응답을 받지 못해 같은 입력을 다시 제출하면 키를 재사용한다. 접수 성공 후 다시 제출하거나 금액·방식을 바꾸면 새 키를 생성한다. 제출 중에는 입력과 중복 제출을 막고, 재시도 전에 도착한 개인 결과는 접수 응답의 요청 ID와 일치할 때만 적용한다.
3. `202`는 `RECEIVED`만 표시한다. 현재가를 낙관적으로 변경하지 않는다.
4. WebSocket 이벤트의 version이 낮으면 무시한다. 같은 version에서는 더 이른 `endsAt`으로 되돌리지 않는다.
5. WebSocket 연결 오류·재연결 뒤에는 REST Snapshot을 다시 조회해 최종 상태를 보정한다.
6. Snapshot 또는 `AuctionEnded`가 `ENDED`이면 이후 입찰 제출을 막는다.

## 3. D. 읽기 모델과 정합성

새 원본 테이블은 만들지 않는다. 상세 Snapshot은 기존 `auction`, `product`, `auction_result`를 단일 읽기 전용 조회로 조합한다.

| 필드 | 출처 | 공개 여부 |
|---|---|---|
| `auctionId`, `title`, `thumbnailObjectKey`, `currentPrice`, `endsAt`, `status`, `auctionVersion` | `auction` + 상품 원본 | 공개 |
| `outcome`, `finalPrice` | 종료된 경우 `auction_result` | 공개 |
| `winnerId`, `auto_bid_maximum`, `bid_ledger` 상세 | 원장/자동입찰 데이터 | 비공개 |

REST Snapshot은 PostgreSQL에서만 읽는다. Redis 상태가 유실되거나 OpenSearch가 지연되어도 상세 조회·입찰 접수의 진실 원천은 바뀌지 않는다. `auctionVersion`은 WebSocket 순서 보정과 Snapshot 최신성 비교에 사용하며 Browser가 임의로 증가시키지 않는다.

## 4. B. API·이벤트 계약

### 4.1 상세 조회

`GET /api/v1/auctions/{auctionId}`는 다음의 공개 Snapshot을 반환한다.

```json
{
  "auctionId": "uuid",
  "title": "camera",
  "thumbnailObjectKey": "products/seller/image-id",
  "currentPrice": 21000,
  "endsAt": "2030-01-01T12:00:00Z",
  "status": "ACTIVE",
  "auctionVersion": 7,
  "outcome": null,
  "finalPrice": null
}
```

없는 경매는 `404 AUCTION_NOT_FOUND`다. `ENDED` Snapshot은 `outcome`과 `finalPrice`를 포함하며 `winnerId`를 포함하지 않는다. `thumbnailObjectKey`를 Browser가 표시 가능한 CDN 또는 서명 URL로 바꾸는 작업은 private bucket 전달 경계를 구현할 때 별도로 처리한다.

### 4.2 입찰 접수

기존 `POST /api/v1/auctions/{auctionId}/bid-requests`를 사용한다. Browser는 인증 주체, `Idempotency-Key`, `bidKind`(`DIRECT` 또는 `AUTO_MAX`), `amount`를 보낸다.

| 응답 | Browser 처리 |
|---|---|
| `202 { bidRequestId, status: "RECEIVED" }` | 접수 표시 후 REST/WebSocket으로 최종 상태 대기 |
| `400 INVALID_BID_REQUEST` | 입력 오류 표시, 현재 Snapshot 유지 |
| `401/403` | 로그인 안내 |
| `404 AUCTION_NOT_FOUND` | 상세 없음 상태로 전환 |
| 종료 뒤 업무 거절 | 거절 이유 표시 후 Snapshot 재조회; 승인 상태로 바꾸지 않음 |

입찰 결과의 개인 승인/거절 이벤트는 요청한 인증 주체에게만 전달한다. `auction.updated`와 `auction.ended`는 공개 Snapshot 필드만 전달한다. Browser가 개인 결과를 잃어도 PostgreSQL Snapshot을 재조회할 수 있어야 한다.

## 5. I. 실행 경계

웹은 Vite 정적 번들, API는 Spring Boot다. 경매 상세 조회와 입찰은 동일한 API origin을 사용한다. Local profile의 `X-Actor-Id`는 로컬·E2E 환경에서만 허용하며 Cognito profile에서는 신뢰하지 않는다.

E2E의 시간 제어는 Browser/OS 시간이 아니라 test-only Spring `Clock` 경계로 제공한다. 이 제어 경계는 `e2e` profile에서만 활성화하고, production image·일반 local profile에는 노출하지 않는다.

## 6. T. 구현 전·후 검증

| 계층 | 최소 검증 |
|---|---|
| React | reducer가 접수 응답으로 가격을 바꾸지 않고, 지연 이벤트가 종료 시각을 되돌리지 않음 |
| Backend | 상세 Snapshot이 비공개 필드를 직렬화하지 않고, 없음/종료 경매를 올바르게 반환 |
| API 통합 | `202 RECEIVED`와 중복 `Idempotency-Key`가 같은 `bidRequestId`로 수렴 |
| Playwright | E2E-01~05의 등록→상세→자동 입찰→종료 흐름, screenshot·trace 보존 |
| 보안 | 다른 사용자의 최대가·낙찰자 식별자가 HTML·REST·WebSocket payload에 없음 |

Playwright는 고정 sleep을 사용하지 않는다. API·WebSocket·검색 Projection은 제한된 polling으로 조건을 확인하고, 제한 시간에는 trace·screenshot·HTTP 응답을 남긴다.

## 7. 후속 구현 분리

1. `[I] 공개 경매 상세 Snapshot API와 PostgreSQL Adapter`
2. `[I] React 경매 상세·입찰 상태와 화면`
3. `[I] E2E 전용 Clock 제어 및 Playwright 실행 기반`
4. #99 Playwright 핵심 E2E 테스트

각 구현 이슈는 이 문서를 참조하고, 실패 테스트부터 시작한다.

## 8. 완료 조건

- [x] S/D/B/I/T 경계와 비공개 데이터 규칙을 정의했다.
- [x] REST Snapshot과 WebSocket 보정의 우선순위를 정의했다.
- [x] 추가 원본 테이블 없이 필요한 읽기 모델을 정의했다.
- [x] #99 전에 필요한 구현 단위를 분리했다.
