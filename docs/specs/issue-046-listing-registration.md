# [Issue #46] 상품 등록 화면·API·이미지 업로드 사양

- 상태: 개정 제안됨
- 작성일: 2026-11-12
- 상위 Epic: [#7 상품 이미지 업로드와 경매 등록 구현](https://github.com/dev-baek/bidflow/issues/7)
- 작업 Issue: [#46 상품 등록 화면·API·이미지 업로드 사양 작성](https://github.com/dev-baek/bidflow/issues/46)
- 선행 사양: [상품·경매 데이터 모델](./issue-042-listing-auction-data-model.md), [이벤트 계약](./issue-008-event-contract.md)
- 후속 작업: #47 업로드 Adapter, #48 등록 화면, #49 등록 API·멱등성, #50 `ListingPublished` 발행
- 개정일: 2026-11-12 — 로컬 S3 호환 구현을 MinIO에서 SeaweedFS로 변경

## 1. 목적과 범위

판매자는 하나 이상의 이미지를 올리고 상품 정보와 경매 기간·시작가를 한 번에 등록한다. 이미지의 바이트는 애플리케이션 서버를 거치지 않고 Browser가 Object Storage에 직접 올린다. 서버는 업로드 권한과 최종 등록 Transaction을 관리한다.

이 문서는 실제 AWS S3 배포 전에도 같은 흐름을 검증할 수 있도록 `ObjectStorage` Port를 정의한다. 로컬은 SeaweedFS(S3 API 호환) Adapter, AWS 이전 후에는 S3 Adapter를 사용한다. Domain은 S3·SeaweedFS·HTTP Client를 참조하지 않는다.

범위에서 제외한다.

- 이미지 편집·자동 썸네일·바이러스 검사
- 상품 수정, 이미지 교체, 경매 재등록
- 공개 이미지 CDN 최적화

## S. 화면 사양

### S.1 등록 화면 상태

```text
EDITING
  ├─ 파일 선택 → UPLOADING_IMAGES → EDITING
  ├─ 유효하지 않은 입력/파일 → VALIDATION_ERROR → EDITING
  ├─ 등록 요청 → SUBMITTING → SUCCEEDED
  └─ 네트워크/서버 오류 → SUBMIT_ERROR → EDITING
```

| 상태 | 사용자에게 보이는 것 | 가능한 행동 |
|---|---|---|
| `EDITING` | 입력 폼, 선택한 이미지별 준비 상태 | 입력 변경, 이미지 추가·삭제, 제출 |
| `UPLOADING_IMAGES` | 개별 이미지 진행률과 취소 버튼 | 완료된 이미지 삭제, 진행 중 업로드 취소 |
| `VALIDATION_ERROR` | 필드별 안정 오류 코드에 대응한 안내 | 오류 필드 수정 |
| `SUBMITTING` | 중복 제출 방지, 등록 중 표시 | 뒤로 가기 전 확인 |
| `SUCCEEDED` | 생성된 상품·경매 상세로 이동 | 상세 조회 |
| `SUBMIT_ERROR` | 요청 ID와 재시도 안내 | 같은 `Idempotency-Key`로 재시도 |

### S.2 입력과 Browser 검증

| 입력 | Browser 선검증 | 서버 최종 검증 |
|---|---|---|
| 제목 | 공백 제거 후 2~100자 | 동일 |
| 설명 | 공백 제거 후 10~5,000자 | 동일 |
| 카테고리 | 허용 목록에서 선택 | 서버 허용 코드 |
| 상품 상태 | 5개 Enum 중 선택 | 동일 |
| 이미지 | 1~10장, JPEG·PNG·WebP, 각 10 MiB 이하 | MIME·크기·소유권·업로드 완료 여부 |
| 시작가 | 1,000원 이상 정수 | 동일 |
| 시작 시각 | 서버 기준 최소 10분 뒤 | 서버 `now` 기준 동일 |
| 종료 시각 | 시작 후 10분~14일 | 동일 |

Browser 검증은 빠른 피드백용이다. 브라우저 시계와 MIME 값은 신뢰 경계가 아니므로 서버와 Object Storage 검증이 최종 기준이다.

### S.3 화면 상태 모델

프론트엔드는 다음을 순수 Reducer 상태로 보관한다. 파일 자체와 `AbortController`는 효과 경계에 두고 Reducer에는 넣지 않는다.

```ts
type ImageUpload = {
  localId: string
  fileName: string
  contentType: string
  size: number
  status: 'PENDING' | 'UPLOADING' | 'UPLOADED' | 'FAILED'
  uploadId?: string
  objectKey?: string
  errorCode?: string
}
```

Reducer Test는 파일 개수 제한, 업로드 완료 전 제출 차단, 실패 이미지 재시도, 동일 `Idempotency-Key` 재시도를 검증한다.

## D. 데이터 사양

### D.1 업로드 요청과 이미지 참조

이미지 바이트의 원본은 Object Storage이며, PostgreSQL에는 최종 등록된 `product_image.object_key`만 저장한다. Presigned URL·Storage Secret·Browser 임시 URL은 DB에 저장하지 않는다.

| 값 | 저장소 | 보존·용도 |
|---|---|---|
| `uploadId` | Object Storage metadata 또는 임시 업로드 기록 | 등록 전 업로드 식별·만료 정리 |
| `objectKey` | Object Storage와 `product_image` | `products/{sellerId}/{uploadId}` 형식, 등록 후 영구 참조 |
| `contentType`, `contentLength` | Object Storage metadata | 업로드 완료 검증 |
| `product_image.display_order` | PostgreSQL | 요청 배열 순서, 0이 대표 이미지 |

업로드는 아직 Product에 연결되지 않은 임시 객체다. 등록 API는 모든 `uploadId`가 요청자 소유이고, 허용된 Content-Type·크기이며 실제 객체가 존재함을 `HEAD` 조회로 확인한다.

### D.2 등록 멱등성

`POST /api/v1/listings`는 `Idempotency-Key` 헤더를 필수로 받는다.

| 상황 | 결과 |
|---|---|
| 최초 요청 | Product·Auction·Image·Outbox를 한 Transaction으로 생성하고 `201 Created` |
| 같은 판매자·같은 Key·같은 요청 본문 재시도 | 최초 결과를 같은 `201 Created` 응답으로 반환 |
| 같은 판매자·같은 Key·다른 요청 본문 | `409 IDEMPOTENCY_KEY_PAYLOAD_MISMATCH` |
| 다른 판매자의 같은 Key | 서로 독립 요청 |

요청 본문의 정규화된 Hash와 판매자 ID, 결과 Product ID를 PostgreSQL에 보관한다. 이 테이블은 #49에서 구현한다.

### D.3 실패 보상

```text
Presign → Browser 직접 업로드 → 등록 Transaction → ProductImage 참조 확정
                                      ├─ 성공: ObjectKey 영구 참조
                                      └─ 실패: 객체는 임시 상태 유지 → 만료 Cleanup 대상
```

- 등록 Transaction 실패 시 API가 즉시 Object를 삭제하지 않는다.
- Browser가 성공 응답을 받지 못해 재시도하는 중에 삭제하면 정상 등록 가능성을 잃을 수 있기 때문이다.
- Cleanup Worker는 생성 후 24시간이 지나고 어떤 `product_image`에도 참조되지 않은 임시 Object만 삭제한다.
- 이미 참조된 Object는 Cleanup 대상이 아니다.
- Object 업로드 실패는 DB 변경을 만들지 않는다.

## B. 백엔드 사양

### B.1 인증 주체 경계

Request Body는 `sellerId`를 받지 않는다. Application은 `AuthenticatedActor` Port에서 판매자 ID를 얻는다.

- 로컬 Profile은 개발 전용 `X-Actor-Id` Header Adapter를 사용한다.
- AWS 이전 후 이 Adapter는 Cognito JWT Claim Adapter로 교체한다.
- 두 경우 모두 Use Case에는 `sellerId` 문자열만 전달되므로 Domain과 등록 흐름은 바뀌지 않는다.
- 운영 Profile에서 `X-Actor-Id` Header는 허용하지 않는다.

### B.2 업로드 URL 발급 API

```http
POST /api/v1/uploads/presign
Content-Type: application/json

{
  "fileName": "camera.jpg",
  "contentType": "image/jpeg",
  "contentLength": 3145728
}
```

성공 응답은 `201 Created`다.

```json
{
  "uploadId": "02ba4c15-53e2-4eb6-a768-6f67d412a454",
  "objectKey": "products/seller-1/02ba4c15-53e2-4eb6-a768-6f67d412a454",
  "method": "PUT",
  "uploadUrl": "https://storage.example/...",
  "requiredHeaders": {
    "Content-Type": "image/jpeg"
  },
  "expiresAt": "2026-11-12T00:15:00Z"
}
```

`ObjectStorage.presignUpload(actorId, contentType, contentLength, uploadId, now)`는 Application Port다. Adapter는 다음 정책을 적용한다.

- 허용 타입: `image/jpeg`, `image/png`, `image/webp`
- 각 파일 최대: 10 MiB
- URL 만료: 발급 후 15분
- Object Key는 서버가 생성하고 Browser가 임의 지정할 수 없다.
- S3 Adapter는 Presigned PUT URL을, 로컬 SeaweedFS Adapter는 동일 S3 API 계약의 URL을 발급한다.

### B.3 등록 API

```http
POST /api/v1/listings
Idempotency-Key: 3bb04aac-3ef1-4e95-a265-a93be8c5c96d
Content-Type: application/json

{
  "title": "중고 카메라",
  "description": "정상 동작하는 미러리스 카메라입니다.",
  "categoryId": "DIGITAL",
  "conditionGrade": "GOOD",
  "images": [
    { "uploadId": "02ba4c15-53e2-4eb6-a768-6f67d412a454" }
  ],
  "startingPrice": 50000,
  "startsAt": "2026-11-12T01:00:00Z",
  "endsAt": "2026-11-12T02:00:00Z"
}
```

성공 응답은 `201 Created`다.

```json
{
  "productId": "2a1a7c65-a6c1-4e51-9a1a-f0b71feaf1cf",
  "auctionId": "ccd7d7e6-6cb0-40ea-a2c7-756ebad335e7",
  "status": "SCHEDULED"
}
```

Use Case는 다음 순서로 실행한다.

1. 인증 판매자와 `Idempotency-Key` 형식을 검증한다.
2. 기존 Key의 Hash와 결과를 조회한다.
3. Product·Auction 순수 규칙과 이미지 배열을 검증한다.
4. `ObjectStorage`에서 각 임시 업로드의 소유권·Metadata·존재를 검증한다.
5. Product, ProductImage, Auction, 멱등 요청 기록, `ListingPublished` Outbox를 하나의 PostgreSQL Transaction으로 저장한다.
6. `201` 결과를 저장하고 반환한다. Kafka 발행은 Transaction 밖의 Outbox Publisher가 담당한다.

### B.4 안정 오류 코드

| HTTP | 코드 | 의미 |
|---:|---|---|
| 400 | `INVALID_PRODUCT_FIELD` | 제목·설명·카테고리·상태 등 입력 위반 |
| 400 | `INVALID_AUCTION_PERIOD` | 시작·종료 시각 또는 기간 위반 |
| 400 | `INVALID_STARTING_PRICE` | 시작가 위반 |
| 400 | `INVALID_IDEMPOTENCY_KEY` | Header 누락 또는 UUID 형식 아님 |
| 403 | `UPLOAD_NOT_OWNED` | 다른 판매자의 임시 업로드 참조 |
| 409 | `UPLOAD_NOT_READY` | URL 만료, Object 없음, 타입·크기 불일치 |
| 409 | `IDEMPOTENCY_KEY_PAYLOAD_MISMATCH` | 같은 Key에 다른 요청 본문 |
| 409 | `ACTIVE_AUCTION_EXISTS` | 상품의 미종료 경매 중복 |

## I. 로컬·AWS 전환 사양

| 환경 | Storage Adapter | 이유 |
|---|---|---|
| 로컬 Docker | SeaweedFS `weed mini`, S3 API 호환 | Presign·CORS·직접 업로드를 비용 없이 재현 |
| AWS 검증 | Amazon S3 | 관리형 내구성·Presigned URL·ALB/EC2 서버 중계 제거 |

SeaweedFS는 S3 자체가 아니며 로컬 통합 검증용이다. 공식 단일 노드 `weed mini` 실행은 S3 Endpoint(기본 8333)와 환경 변수로 지정한 Bucket을 제공한다. S3 고유 정책(IAM, Lifecycle, Event Notification)은 AWS 검증 단계에서 별도 확인한다.

필수 CORS는 개발 Origin에서 `PUT`와 `Content-Type` Header를 허용하고, Production에서는 CloudFront 도메인만 허용한다. Bucket은 공개 읽기를 허용하지 않는다. 조회 URL 정책은 이미지 제공 기능에서 별도 확정한다.

## T. 검증 사양

| 계층 | 검증 | 정상·오류·경계 |
|---|---|---|
| Frontend Reducer | 이미지·제출 상태 전이 | 업로드 완료 전 제출 차단, 실패 재시도, 중복 제출 차단 |
| Domain | Product·Auction 순수 규칙 | #45 경계 테스트 재사용 |
| Application | 등록 Use Case | Object 소유권, DB Transaction, Idempotency Key 재시도·충돌 |
| Adapter 통합 | SeaweedFS Presign·HEAD | 허용 MIME·10 MiB, 만료 URL, 다른 판매자 Object 거절 |
| E2E | Browser 직접 업로드 후 등록 | 1장·10장 정상, 0장·11장, 업로드 실패, 등록 재시도 |
| Cleanup | 미참조 임시 Object | 24시간 전 보존, 24시간 후 미참조만 삭제, 참조 Object 보존 |

## 2. 완료 조건

- [x] 화면 상태, 입력 검증, 업로드·제출 순서가 정의됐다.
- [x] 임시 Object와 PostgreSQL 참조의 책임·실패 보상이 정의됐다.
- [x] 등록 API, Idempotency Key, 소유권과 오류 계약이 정의됐다.
- [x] 로컬 SeaweedFS와 AWS S3의 Adapter 경계·CORS 정책이 정의됐다.
- [x] S/D/B/I/T별 후속 구현·검증 범위가 분리됐다.

## 3. 개정 기록 — SeaweedFS 선택

초기에는 MinIO를 로컬 S3 호환 구현으로 정했다. 그러나 2026-11-12 기준 MinIO의 공식 Container Image가 익명 Pull에서 인증 오류를 반환해, 이 저장소의 `make local-up` 재현 조건을 충족하지 못했다. 비공식 Mirror를 사용하면 이미지 출처와 공급망 검증 책임이 불명확해진다.

따라서 로컬 구현만 공개 Docker Image를 제공하는 SeaweedFS의 `weed mini`로 교체한다. SeaweedFS는 S3 API를 제공하고, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `S3_BUCKET`으로 단일 노드 테스트 환경을 만들 수 있다. Application Port와 AWS SDK v2 Adapter 인터페이스는 변하지 않으므로, AWS 전환 시 Amazon S3 Endpoint·Credential Provider만 교체한다.

- SeaweedFS 공식 Quick Start: [S3 Endpoint·Bucket·Docker 실행](https://github.com/seaweedfs/seaweedfs)
- AWS SDK v2 공식 문서: [Presigned PUT URL](https://docs.aws.amazon.com/sdk-for-java/latest/developer-guide/examples-s3-presign.html)
