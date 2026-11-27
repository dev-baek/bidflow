# 공개 경매 사진 읽기 계약 (#390)

## S. 화면

- 검색 결과는 `hasThumbnail`이 참이면 경매 ID로 대표 사진을 요청한다. 상세는 사진 ID를 조회해 등록 순서대로 표시한다.
- 사진이 없거나 조회에 실패하면 해당 사진만 같은 비율의 “사진 없음”으로 대체한다. 경매 상태·현재가·입찰은 사진 조회와 독립적이다. 목록·상세의 최종 레이아웃은 #372, #374에서 적용한다.

## D. 공개 판정

- PostgreSQL에서 경매 ID로 상품을 찾고, 상품은 `PUBLISHED`, 경매는 `SCHEDULED`, `ACTIVE`, `ENDED` 중 하나여야 한다. 사진 ID는 그 상품의 `product_image`에 속해야 한다. 취소·비공개·없는 경매와 다른 상품의 사진은 발급하지 않는다.
- 대표 사진은 `display_order`가 가장 앞선 등록 사진이다. OpenSearch의 기존 인덱스 필드는 대표 사진 유무 힌트로만 쓰고 발급 판단에는 사용하지 않는다. 스키마와 인덱스 변경은 없다.

## B. API와 스토리지

| GET 경로 | 성공 | 사진 없음 또는 공개 대상 아님 |
| --- | --- | --- |
| `/api/v1/auctions/{auctionId}/images` | `200 {"imageIds":["<uuid>"]}` | 공개 경매지만 사진이 없으면 빈 배열, 비공개·없는 경매는 `404` |
| `/api/v1/auctions/{auctionId}/images/thumbnail` | 첫 사진의 읽기 주소로 `307` | `404` |
| `/api/v1/auctions/{auctionId}/images/{imageId}` | 해당 사진의 읽기 주소로 `307` | `404` |

- 요청에는 경매·사진 ID만 사용한다. 검색·상세 JSON 응답에서 `thumbnailObjectKey`를 제거하고 `hasThumbnail`을 제공한다. 브라우저는 키를 받거나 저장소 주소를 직접 조합해 서명을 요청하지 않는다.
- DB 확인 후 후보 객체에만 HEAD를 사용해 존재 여부와 기존 사진 형식·크기 정책을 확인한다. 통과하면 전용 헤더 없이 브라우저가 사용할 수 있는 5분 유효 GET 주소를 반환한다. API 응답과 스토리지 GET은 `no-store`를 사용한다. 이미 발급한 주소는 공개 상태가 바뀌어도 최대 5분 동안 유효할 수 있다.
- 버킷 공개 설정은 변경하지 않는다. SeaweedFS에서 인증 없는 원본 GET 거부와 서명 GET 성공을 검증한다. 실제 AWS 배포나 IAM 변경은 이 작업 범위 밖이다.
- SDK 설정 근거: [브라우저 호환 서명](https://docs.aws.amazon.com/java/api/latest/software/amazon/awssdk/services/s3/presigner/S3Presigner.html), [서명 GET 응답 헤더](https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetObject.html).
