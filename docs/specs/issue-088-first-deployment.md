# [Issue #88] 검증 환경 첫 배포 입력과 실행 순서

- 상태: 제안. 이 문서는 Terraform 변경이나 AWS 접속을 승인하지 않는다.
- 작업 이슈: [#88 배포 구성](https://github.com/dev-baek/bidflow/issues/88). 실제 배포·Smoke·삭제 증적은 [#91](https://github.com/dev-baek/bidflow/issues/91)에 남긴다.
- 선행 사양: [인증 배포 연결](issue-088-auth-deployment-wiring.md), [상품 이미지 S3](issue-088-verification-image-storage.md), [AWS 배포·삭제 Runbook](issue-017-aws-deployment.md).

## 문제

현재 verification 루트는 ECR 저장소를 생성하는 동시에 EC2에 배포할 ECR image digest를 필수 입력으로 받는다. 첫 배포에서는 저장소가 아직 없어 해당 digest를 얻을 수 없다. 임시 digest로 EC2를 띄우면 실제 image pull이 실패한다. 기존 루트의 `-target` 우회나 별도 state 없이, 같은 state에 대해 EC2만 명시적으로 보류할 수 있어야 한다.

## S. 운영자 흐름

| 단계 | 진입 조건 | 성공 판정 |
|---|---|---|
| 1. EC2 보류 | 승인된 계정·리전·시간·비용 범위, backend와 인증서 등 선행 입력 준비 | 일반 Plan에 ECR과 승인된 구성은 보이지만 ASG·Launch Template은 없다. ALB는 앱이 준비될 때까지 검증 URL로 공유하지 않는다. |
| 2. Artifact 준비 | 1단계 Plan 검토 및 승인 후 적용 | 해당 ECR에 ARM64 OCI 이미지를 게시하고 같은 저장소에 실제로 게시된 digest와 소스 커밋을 대조한다. |
| 3. EC2 활성화 | ECR digest, 사전 준비한 ARM64 AMI, Runtime Secret 참조 확보 | 새 Plan을 검토·승인한 뒤 같은 state로 적용한다. 실제 ALB readiness·Cognito·상품 등록 및 종료 후 정리는 #91에서 검증한다. |

1단계는 무료 모드가 아니다. ALB·RDS·CloudFront와 명시적으로 켠 서비스가 포함될 수 있으므로, 첫 Plan부터 검증 시간과 비용을 승인 범위에 넣는다. 이미 활성화한 환경을 갱신할 때 1단계 설정을 다시 적용하지 않는다. 그 경우 EC2가 제거되므로 삭제 계획은 별도로 검토한다.

## D. 입력과 증적

| 종류 | 배포 전 확인 |
|---|---|
| 공통 | `expected_account_id`, `region=ap-northeast-1`, `owner`, UTC `ttl`, 검증 전용 backend, 동일 계정의 GitHub OIDC provider, ALB용 ACM 인증서 |
| 브라우저 | 공개 API FQDN, 그 호스트명에 맞는 인증서 및 DNS 준비; Cognito 활성화 시 도메인 prefix, 상품 등록 검증 시 이미지 버킷 활성화도 필요 |
| EC2 활성화 시 | `application_ami_id`(ARM64·Docker·AWS CLI·jq), `application_image`(현재 검증 ECR 저장소의 `@sha256:…` URI), `application_runtime_secret_arn`, `enable_nat_gateway=true` |
| Runtime Secret | Terraform에는 ARN만 제공한다. Secret 값은 부팅 스크립트가 읽는 Docker env-file(`KEY=value`) 형식이다. JSON 객체, 평문 tfvars, 로그 출력, Terraform이 조립하는 설정의 덮어쓰기를 사용하지 않는다. |

계정 식별자·ARN·입력 파일·저장된 Plan은 저장소 밖에서 관리한다. 공개 보고서에는 커밋, image digest, 실행 시간과 결과만 남기고, 계정 접근키·Secret 값·presigned URL·Terraform state를 포함하지 않는다.

## I. 구현 계약

- verification 루트에서 `enable_application_runtime`을 제공한다. 기본값은 기존 동작을 보존하는 `true`이고, 첫 배포에서만 명시적으로 `false`를 사용한다. `false`인 Plan에는 private runtime 모듈의 ASG·Launch Template이 없어야 하고 ASG 이름 출력은 비어 있어야 한다. ECR 출력은 유지한다.
- EC2 미생성 단계에서는 이미지·AMI·Runtime Secret 참조를 생략할 수 있다. 활성화 단계에서는 세 입력 누락, 다른 저장소의 digest, 태그 URI를 거부한다. 기존 AMI ID·Secret ARN·NAT 검증은 유지한다. URI 검증은 이미지 존재·아키텍처를 증명하지 않으므로 실제 확인은 Artifact 준비 단계에 둔다.
- 기존 runtime 모듈에 인스턴스 주소가 추가된다면 `moved` 선언으로 기존 주소를 보존한다. 스위치 도입만으로 활성화된 환경이 교체되는 Plan은 허용하지 않는다.
- 승인 전에는 새 자격 증명을 받거나 AWS API, 원격 backend, 실제 AWS Plan을 실행하지 않는다. 선택형 데이터 서비스의 실제 연결과 설치 절차, 실제 이미지 게시, TLS, SSM, Instance Refresh는 이번 변경의 증거로 간주하지 않는다.

## T. 구현 완료 기준

1. 기존 Terraform 모의 테스트에 첫 배포를 재현하는 실패 케이스를 먼저 추가한다. runtime 입력 없이 EC2를 보류한 Plan에서 ASG·Launch Template은 0개, ECR은 1개다.
2. 활성화 시 누락 입력과 태그·다른 저장소 URI를 각각 거부한다. 유효한 입력은 기존 runtime을 조립하며 #341의 이미지 IAM·CORS·IMDSv2 모의 테스트도 유지한다.
3. 변경된 입력과 두 단계의 운영 절차를 Terraform README에 반영한다. 기존 활성화 경로의 업데이트를 강제 교체하지 않는지 주소 계약을 확인한다.
4. 모의 Provider 결과를 실제 Deploy·Smoke·Destroy 성공으로 보고하지 않는다. 검증 환경이 필요해지는 시점에 계정·리전·시간·예상 비용·정리 범위를 별도로 승인받는다.
