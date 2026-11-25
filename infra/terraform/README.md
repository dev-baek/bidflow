# Terraform 검증 환경

Terraform은 AWS 검증 환경에만 사용한다. 로컬 개발은 [Docker Compose](../local/compose.yaml)를 사용하며 AWS 리소스를 만들지 않는다.

## Workspace

- `bootstrap`: S3 state bucket과 DynamoDB lock table을 만든다. `prevent_destroy`가 적용되어 verification 환경 종료 시에도 남는다.
- `environments/verification`: 검증용 리소스를 조립한다. account/Region/environment guard, backend 계약과 Network Module을 포함한다.
- `modules/network`: 두 AZ의 public ALB/application/data subnet과 최소 Security Group을 만든다. NAT Gateway는 `enable_nat_gateway=false`가 기본이며, 활성화해도 application subnet에만 경로를 추가한다.
- `modules/iam`: GitHub OIDC trust role과 EC2 application instance profile을 분리한다. Runtime은 ECR·S3 image prefix·Secrets Manager·CloudWatch Logs·MSK IAM 인증만 허용하며 PostgreSQL은 Security Group과 Secret 기반 JDBC로 접근한다.
- `modules/budget`: 계정 전체 월간 비용의 80%·100% 실제/예측 알림을 만든다. 기본 한도는 `100000 KRW`지만 apply 전 계정 청구 통화를 확인한다.
- `modules/web_delivery`: Vite build artifact를 담는 private S3 bucket과 CloudFront OAC를 만든다. CloudFront만 읽을 수 있고, artifact upload와 invalidation은 후속 배포 workflow의 책임이다.
- `modules/cognito`: 기본 비활성화 상태의 검증용 User Pool, 공개 App Client, 로그인 도메인이다. 활성화 시 `cognito_domain_prefix`를 지정하고, `cognito_public_config`에서 CloudFront의 고정 반환 URL과 공개 인증 값을 확인한다. [#39 계약](../../docs/specs/issue-039-cognito-terraform-contract.md)
- `modules/application_edge`: immutable·scan-on-push ECR repository와 public HTTPS ALB/readiness Target Group을 만든다. EC2 Auto Scaling Group은 image digest를 받아 다음 구현 단위에서 연결한다.
- `modules/private_runtime`: private subnet의 ARM64 EC2 Auto Scaling Group을 immutable ECR digest로 기동한다. 부팅 시 RDS-managed Secret을 읽어 root-owned JDBC 환경 파일을 조립하므로 credential은 tfvars·User Data에 남지 않는다. AMI에는 Docker, AWS CLI, `jq`가 사전 설치돼야 한다. 현재 첫 검증 구현은 ECR·Secrets 접근을 위해 `enable_nat_gateway=true`를 명시적으로 요구하며, 해당 비용은 VPC Endpoint 구현 전 승인 대상이다.
- `modules/private_rds`: private data subnet의 PostgreSQL 원장을 만든다. RDS-managed Secret을 사용하므로 Terraform variable에 DB password를 넣지 않으며, 검증 종료 때 final snapshot을 남기지 않는다.

## 실행 전 조건

1. `ap-northeast-1`의 검증 전용 AWS account ID를 확인한다.
2. 80,000원·100,000원 Budget Alarm을 확인한다.
3. `expected_account_id`, `owner`, `ttl`을 Repository 밖의 tfvars 또는 CI Secret Store로 제공한다.
4. bootstrap 출력으로 만든 `backend.hcl`을 Repository 밖에 둔다.
5. Plan을 검토한 뒤에만 apply하며 `-auto-approve`는 사용하지 않는다.
6. Destroy 뒤에는 NAT Gateway, Elastic IP, RDS Snapshot, CloudWatch Log Group의 잔존 비용을 Tag inventory와 Cost Explorer로 확인한다.
7. web asset bucket은 versioning이 켜져 있다. `destroy` 전에 release prefix와 object version·delete marker를 먼저 비워야 하며, Terraform이 임의의 artifact를 강제 삭제하지 않는다.

## 검증 명령

### Cognito 모의 검증

원격 backend가 초기화되지 않은 별도 로컬 작업 트리에서만 아래 명령을 사용한다. Terraform Provider 설치에는 패키지 접근이 필요하지만, 테스트는 AWS/Random Provider를 모의 처리하며 실계정이나 자격 증명을 사용하지 않는다.

```sh
terraform -chdir=infra/terraform/environments/verification fmt -check -recursive . ../../modules/cognito
terraform -chdir=infra/terraform/environments/verification init -backend=false -lockfile=readonly
terraform -chdir=infra/terraform/environments/verification validate
terraform -chdir=infra/terraform/environments/verification test
```

모의 테스트의 `apply`와 target은 테스트 파일 안에서만 쓰인다. 실제 AWS 배포에서 부분 apply를 하라는 절차가 아니다. 공개 출력의 주입과 TLS·REST CORS·STOMP 연결은 #88, 실제 로그인과 삭제는 #91에서 검증한다.

### 인증 설정과 Vite 빌드

Cognito 활성화 시 ALB 인증서와 일치하는 API 호스트명을 `verification_api_fqdn`으로 지정한다. DNS·인증서 일치는 별도로 확인한다. EC2의 시작 스크립트는 Cognito issuer·Client ID와 CloudFront origin, `verification` 프로필을 Terraform에서 받아 설정한다. Runtime Secret은 기존 Docker env-file 형식 그대로이며 해당 설정이나 프로필을 덮는 키를 포함하면 앱을 시작하지 않는다.

승인된 배포에서는 Terraform의 공개 출력 객체 `verification_web_build_env`만 별도 JSON 파일로 전달한다. 전체 state 또는 모든 출력값을 전달하지 않는다. 저장소 루트에서 이 파일을 사용해 빌드한다.

```sh
node scripts/build-verification-web.mjs /safe/path/verification-web-public.json
```

이 빌드는 다른 `VITE_*` 설정과 로컬 dotenv 파일을 사용하지 않으며 AWS 호출·업로드를 하지 않는다. 실제 인증과 S3 직접 업로드 검증은 [#91](https://github.com/dev-baek/bidflow/issues/91)에 남겨둔다.

### 승인 후 실제 검증 환경

Terraform CLI가 설치된 환경에서 다음 명령을 사용한다. `apply`와 `destroy`는 [AWS Runbook](../../docs/specs/issue-017-aws-deployment.md)의 승인·잔여 리소스 확인 절차를 통과한 경우에만 수행한다.

```bash
terraform -chdir=infra/terraform/bootstrap fmt -check
terraform -chdir=infra/terraform/environments/verification fmt -check
terraform -chdir=infra/terraform/environments/verification init -backend-config=/safe/path/backend.hcl
terraform -chdir=infra/terraform/environments/verification validate
terraform -chdir=infra/terraform/environments/verification plan -var-file=/safe/path/verification.tfvars
```

`backend.hcl`과 `*.tfvars`는 commit하지 않는다. 현재 Mac에 Terraform CLI가 없으면 `tests/scripts/terraform-foundation.test.sh`의 정적 계약 검증만 실행하고, Terraform CLI 설치 또는 CI 환경에서 `fmt`·`init`·`validate`를 이어서 수행한다.
