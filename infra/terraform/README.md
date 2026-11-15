# Terraform 검증 환경

Terraform은 AWS 검증 환경에만 사용한다. 로컬 개발은 [Docker Compose](../local/compose.yaml)를 사용하며 AWS 리소스를 만들지 않는다.

## Workspace

- `bootstrap`: S3 state bucket과 DynamoDB lock table을 만든다. `prevent_destroy`가 적용되어 verification 환경 종료 시에도 남는다.
- `environments/verification`: 검증용 리소스를 조립한다. account/Region/environment guard, backend 계약과 Network Module을 포함한다.
- `modules/network`: 두 AZ의 public ALB/application/data subnet과 최소 Security Group을 만든다. NAT Gateway는 `enable_nat_gateway=false`가 기본이며, 활성화해도 application subnet에만 경로를 추가한다.
- `modules/iam`: GitHub OIDC trust role과 EC2 application instance profile을 분리한다. Runtime은 ECR·S3 image prefix·Secrets Manager·CloudWatch Logs·MSK IAM 인증만 허용하며 PostgreSQL은 Security Group과 Secret 기반 JDBC로 접근한다.
- `modules/budget`: 계정 전체 월간 비용의 80%·100% 실제/예측 알림을 만든다. 기본 한도는 `100000 KRW`지만 apply 전 계정 청구 통화를 확인한다.
- `modules/web_delivery`: Vite build artifact를 담는 private S3 bucket과 CloudFront OAC를 만든다. CloudFront만 읽을 수 있고, artifact upload와 invalidation은 후속 배포 workflow의 책임이다.
- `modules/application_edge`: immutable·scan-on-push ECR repository와 public HTTPS ALB/readiness Target Group을 만든다. EC2 Auto Scaling Group은 image digest를 받아 다음 구현 단위에서 연결한다.

## 실행 전 조건

1. `ap-northeast-1`의 검증 전용 AWS account ID를 확인한다.
2. 80,000원·100,000원 Budget Alarm을 확인한다.
3. `expected_account_id`, `owner`, `ttl`을 Repository 밖의 tfvars 또는 CI Secret Store로 제공한다.
4. bootstrap 출력으로 만든 `backend.hcl`을 Repository 밖에 둔다.
5. Plan을 검토한 뒤에만 apply하며 `-auto-approve`는 사용하지 않는다.
6. Destroy 뒤에는 NAT Gateway, Elastic IP, RDS Snapshot, CloudWatch Log Group의 잔존 비용을 Tag inventory와 Cost Explorer로 확인한다.
7. web asset bucket은 versioning이 켜져 있다. `destroy` 전에 release prefix와 object version·delete marker를 먼저 비워야 하며, Terraform이 임의의 artifact를 강제 삭제하지 않는다.

## 검증 명령

Terraform CLI가 설치된 환경에서 다음 명령을 사용한다. `apply`와 `destroy`는 [AWS Runbook](../../docs/specs/issue-017-aws-deployment.md)의 승인·잔여 리소스 확인 절차를 통과한 경우에만 수행한다.

```bash
terraform -chdir=infra/terraform/bootstrap fmt -check
terraform -chdir=infra/terraform/environments/verification fmt -check
terraform -chdir=infra/terraform/environments/verification init -backend-config=/safe/path/backend.hcl
terraform -chdir=infra/terraform/environments/verification validate
terraform -chdir=infra/terraform/environments/verification plan -var-file=/safe/path/verification.tfvars
```

`backend.hcl`과 `*.tfvars`는 commit하지 않는다. 현재 Mac에 Terraform CLI가 없으면 `tests/scripts/terraform-foundation.test.sh`의 정적 계약 검증만 실행하고, Terraform CLI 설치 또는 CI 환경에서 `fmt`·`init`·`validate`를 이어서 수행한다.
