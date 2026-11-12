# [Issue #47] S3 호환 직접 업로드 Adapter 검증 보고서

- 상태: 완료
- 작성일: 2026-11-12
- 관련 사양: [상품 등록·이미지 업로드](../specs/issue-046-listing-registration.md)
- 관련 Issue: [#47 S3 Presigned URL 발급과 업로드 정책 구현](https://github.com/dev-baek/bidflow/issues/47)

## 구현 경계

`application`의 `ObjectStorage` Port는 Presigned Upload 발급과 Object Metadata 조회만 정의한다. `adapters`의 `S3ObjectStorage`는 AWS SDK v2의 `S3Client`, `S3Presigner`를 사용해 SeaweedFS와 Amazon S3 양쪽에 연결한다.

| 책임 | 위치 | 이유 |
|---|---|---|
| 업로드 요청·응답 계약 | `application` | 등록 Use Case가 저장소 제품을 모르도록 분리 |
| MIME·크기·Key 정책 | `adapters/storage` | Object Storage 호출 직전의 신뢰 경계 |
| AWS Signature v4·Presign·HEAD | `adapters/storage` | 외부 SDK 효과 경계 |
| 로컬 S3 호환 Endpoint | Compose SeaweedFS | AWS 비용 없이 Browser 직접 PUT 검증 |

## 정책

- 허용 Content-Type: JPEG, PNG, WebP
- 파일 크기: 1 byte~10 MiB
- URL 만료: 15분
- Key: `products/{actorId}/{uploadId}`
- `actorId`는 Object Key 경로 이탈을 막기 위해 영숫자·`_`·`-` 1~128자로 제한한다.
- S3 Client와 Presigner는 path-style Endpoint를 사용한다. 로컬 SeaweedFS와 향후 S3 호환 테스트의 주소 형식 차이를 Adapter에 가둔다.

## TDD 증적과 통합 검증

1. `ObjectStorage` Port와 `S3ObjectStorage`가 없는 상태에서 통합 Test가 컴파일 실패했다(RED).
2. AWS SDK v2 기반 Adapter를 추가했다.
3. Testcontainers SeaweedFS 4.38에서 Presigned PUT URL을 발급했다.
4. JDK `HttpClient`로 URL에 직접 `PUT`하고, `HEAD`로 Content-Type과 바이트 수를 확인했다(GREEN).
5. GIF와 10 MiB 초과 요청이 `UploadPolicyViolation`으로 거절되는 것을 검증했다.

## 로컬 실행

`make local-up`은 SeaweedFS `weed mini`를 `object-storage` 서비스로 함께 기동한다. `S3_BUCKET` 환경 변수로 `bidflow-images` Bucket을 생성하고, S3 Endpoint만 Host의 `127.0.0.1:8333`으로 노출한다. SeaweedFS의 Master 상태 조회가 성공해야 Healthcheck가 통과한다. 실제 `make local-up` 실행에서 네 서비스가 모두 Healthy이고 Bucket 생성 로그가 출력되는 것을 확인했다.
