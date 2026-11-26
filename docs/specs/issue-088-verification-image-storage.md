# [Issue #88] 검증 환경 상품 이미지 S3 계약

- 상태: 검토 대기. [#88 배포 조립](https://github.com/dev-baek/bidflow/issues/88)의 후속 사양이다.
- 선행: [상품 등록 사양](issue-046-listing-registration.md), [인증 배포 연결](issue-088-auth-deployment-wiring.md), [AWS 배포·삭제 Runbook](issue-017-aws-deployment.md).

현재 등록 코드는 `products/{sellerId}/{uploadId}`로 읽고 쓰지만 Terraform의 앱 역할은 `images/*`를 허용한다. 업로드 어댑터는 SeaweedFS용 endpoint와 고정 credentials만 사용한다. 정적 웹 파일과 별도의 비공개 S3 버킷에, 실제 키와 일치하는 권한 및 EC2 역할 기반 서명을 연결한다.

## S. 등록 흐름

판매자 화면은 기존처럼 인증된 API에서 업로드 URL을 받은 뒤 파일을 S3에 직접 PUT한다. PUT에는 S3가 요구하는 서명된 요청 헤더만 넣고 앱의 Bearer 토큰·쿠키·개발자 ID를 보내지 않는다. 업로드가 끝나면 기존 상품 등록 API로 `uploadId`를 보낸다. 이미지 공개 다운로드나 CloudFront 이미지 배포는 추가하지 않는다.

검증 S3를 끈 경우 verification 프로필에서 이미지 업로드·이미지가 필요한 새 상품 등록은 저장소를 사용할 수 없다는 일반 오류로 응답한다. 로컬 endpoint나 개발 credentials로 대체하지 않는다. 기존 로컬 SeaweedFS의 정상 등록 흐름은 유지한다.

## D. 버킷과 권한

- 기존 CloudFront 정적 파일 버킷과 분리한 검증용 버킷 하나를 `ap-northeast-1`에 둔다. 계정·환경을 포함한 이름, 공개 접근 차단, ACL 비활성화, SSE-S3, HTTPS 전용 정책을 사용한다. 자동으로 객체를 삭제하는 `force_destroy`는 켜지 않는다.
- IAM은 추정 이름을 조합하지 않고 실제 버킷의 ARN을 참조한다. EC2 앱 역할은 그 버킷의 `products/*`에만 `s3:GetObject`와 `s3:PutObject`를 받는다. 전용 버킷 자체에만 `s3:ListBucket`을 허용해 없는 객체의 HEAD 404와 권한 실패 403을 구분한다. 앱에는 삭제·버킷 관리 권한을 주지 않는다. [S3 HeadObject 권한 계약](https://docs.aws.amazon.com/AmazonS3/latest/API/API_HeadObject.html).
- CORS origin은 인증에서 사용하는 정확한 CloudFront HTTPS origin 하나다. 브라우저 PUT만 허용하며 서명에서 사용하는 `Content-Type`과 `If-None-Match`만 명시한다. 공개 GET, 모든 origin·헤더 허용, ALB origin의 중복 등록은 하지 않는다.

## B. 서명과 HEAD 검증

검증용 SDK client와 presigner는 EC2 instance profile의 임시 credentials를 사용하고, 로컬 endpoint override 및 고정 credentials를 사용하지 않는다. 지역에 맞는 표준 S3 HTTPS endpoint를 사용하며 URL·서명·세션 토큰은 로그에 쓰지 않는다. 임시 credentials가 먼저 만료될 수 있으므로 기존 15분은 최대 서명 유효기간으로 해석한다. [AWS SDK presign 계약](https://docs.aws.amazon.com/sdk-for-java/latest/developer-guide/examples-s3-presign.html).

검증 S3의 PUT에는 `If-None-Match: *`를 서명하고 브라우저에 돌려준다. 같은 키에 두 번째 PUT을 보내 기존 이미지를 바꿀 수 없게 한다. `Content-Type`과 이 조건 외에 브라우저에서 보낼 수 없는 필수 헤더가 생기지 않는지 로컬 SDK 대역에서 검사한다. 서명만으로 전송량이 10 MiB를 넘지 않는다고 가정하지 않는다. [S3 조건부 쓰기](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html).

등록에서 현재는 HEAD의 존재 여부만 확인한다. 기존 상품 등록 사양대로 인증 주체의 키에서 저장된 Content-Type과 길이(1바이트~10 MiB)까지 확인한다. HEAD 메타데이터 검증은 이미지 바이트를 디코딩하는 검사가 아니다. 조회 결과 없음·형식/크기 불일치는 등록하지 않고, 403을 단순 미업로드로 숨기지 않는다. 유효한 등록의 DB·Outbox와 멱등 계약은 바꾸지 않는다.

## I. 실행과 승인

검증 S3는 명시적인 스위치로 기본 비활성화한다. 활성화에는 검증 Cognito 구성도 필요하다. 버킷 이름과 리전은 EC2에 공개 설정으로 전달하고, 액세스 키를 Runtime Secret·User Data·Vite에 넣지 않는다. 컨테이너의 EC2 역할 접근에 필요한 IMDSv2 토큰 응답 hop limit 2는 이 경로를 켤 때만 적용하고 토큰 필수 설정과 기존 네트워크 경계는 유지한다. [EC2 컨테이너의 IMDSv2 접근](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/instancedata-data-retrieval.html).

앱이 받는 공개 설정은 `BIDFLOW_STORAGE_VERIFICATION_BUCKET` (`bidflow-verification-<account-id>-images`)과 `BIDFLOW_STORAGE_VERIFICATION_REGION` (`ap-northeast-1`)이다. 버킷이 비어 있으면 서버는 S3 서명을 발급하지 않는다. Terraform 버킷·IAM·EC2 주입은 앱 구현과 분리한다.

실제 버킷 생성과 권한 변경은 계정·리전·시간·비용·삭제 계획의 승인 이후에만 한다. 종료 시 앱 역할이 아닌 승인된 정리 권한으로 해당 검증 버킷의 객체와 존재하는 버전·삭제 마커를 확인하고 비운다. 다른 버킷은 건드리지 않으며, 대상 버킷과 비용 리소스가 남으면 성공으로 기록하지 않는다.

## T. 구현 및 완료 기준

1. 실패 테스트부터 작성한다. Terraform 모의 테스트에서 비활성화, 버킷·CORS와 IAM ARN 범위, EC2 설정·IMDSv2 설정을 확인한다. 모의 Provider는 실제 S3 권한이나 DNS 성공 증거가 아니다.
2. 네트워크 없이 테스트 credentials로 HTTPS URL과 브라우저 헤더 계약을 검사하고, 등록 서비스의 HEAD 누락·메타데이터 불일치·정상 저장 회귀를 확인한다. 기존 SeaweedFS 정상 경로는 유지한다.
3. [#91](https://github.com/dev-baek/bidflow/issues/91)에서만 실제 CloudFront → presign → PUT → HEAD/등록, 다른 origin 거부, 같은 키 재업로드 거부, 삭제를 확인한다. 이번 사양은 AWS 접속이나 리소스 생성을 승인하지 않는다.
