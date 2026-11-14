# [Issue #33] Terraform 환경·비용·삭제 정책

- 상태: 제안됨
- 관련 Issue: [#33 Terraform 환경·비용·삭제 정책 사양 작성](https://github.com/dev-baek/bidflow/issues/33)
- 후속 구현: #34 State·Provider, #35 Network, #36 IAM, #37 Budget, #88 Runtime, #89 Data Service
- 배포 Runbook: [AWS 검증 환경 배포·삭제](issue-017-aws-deployment.md)

## 1. 결정

BidFlow는 로컬 개발 환경을 Terraform으로 만들지 않는다. 로컬 PostgreSQL·Kafka·Redis·OpenSearch·SeaweedFS는 Docker Compose로만 실행한다. Terraform은 **짧게 생성하고 삭제하는 AWS 검증 환경**과, 그 환경의 state를 안전하게 보관하는 bootstrap에만 사용한다.

Terraform 구조는 다음 세 층으로 나눈다.

```text
infra/terraform/
  bootstrap/              state backend·Budget·검증 실행 Role의 최소 기반
  environments/
    verification/         VPC, Data, Runtime, 관측 리소스 조립
  modules/                network, iam, budget, data, runtime, observability
```

- `bootstrap`은 검증 환경을 `destroy`해도 남는다. state 보관과 Budget Alarm을 잃어버리지 않기 위한 최소 비용 기반이다.
- `verification`은 `apply`와 `destroy`의 대상이며, 실행이 끝나면 비용 리소스가 남지 않아야 한다.
- Module은 리소스를 만드는 단위이고, 계정·Region·환경 값을 자체적으로 선택하지 않는다.
- 현재 이 디렉터리와 Terraform 코드는 아직 없다. #34에서 이 계약을 구현하며, 그 전에는 `terraform init/plan/apply`를 실행하지 않는다.

## 2. S. 개발자·운영자 경험

| 상황 | 허용 동작 | 금지 동작 |
|---|---|---|
| 평소 개발 | Docker Compose와 단위/통합 테스트 | AWS 리소스 자동 생성 |
| AWS 검증 준비 | 명시한 검증 account/Region, Plan Review | 기본 AWS profile·알 수 없는 workspace 사용 |
| 검증 실행 | 승인된 TTL 안의 `verification` apply | `-auto-approve`, production workspace apply |
| 검증 종료 | Tag inventory 확인 뒤 destroy | state backend 먼저 삭제, 잔여 비용 무시 |
| 장애/중단 | apply 중단, 실제 생성 목록과 비용 영향 기록 | state를 수동 삭제해 Terraform 추적 상실 |

검증용 환경은 사용자가 접속하는 상시 서비스가 아니다. URL, Cognito 계정, 상품 이미지와 테스트 데이터는 검증 종료 시 폐기한다.

## 3. D. Terraform state와 민감 데이터

### 3.1 State backend

| 항목 | 정책 |
|---|---|
| 위치 | 전용 S3 state Bucket과 DynamoDB lock table 또는 Terraform Cloud 중 하나를 bootstrap에서 선택 |
| 암호화 | S3 SSE 및 versioning, state 접근 최소 IAM; state에 Secret 값을 넣지 않음 |
| 잠금 | 동시 apply/destroy를 막는 lock 필수 |
| 분리 | `bootstrap`과 `verification`은 별도 state key; 환경별 key도 분리 |
| 접근 | 검증 전용 GitHub OIDC Role과 최소 운영자 Role만 read/write, 일반 application Role은 읽지 못함 |
| 삭제 | `verification` destroy 전에 backend를 삭제하지 않음; backend 해제는 state archive와 별도 승인 후 수행 |

Terraform state는 민감할 수 있다. Database password, Cognito client secret, access key, JWT, presigned URL을 resource argument, output, local file, CI Log에 넣지 않는다. Secret은 AWS Secrets Manager의 ARN만 state에 참조시키고 실제 값은 Runtime의 Instance Profile로 읽는다.

### 3.2 환경 입력과 출력

| 구분 | 허용 | 금지 |
|---|---|---|
| Variable | account ID allowlist, Region, environment, TTL, image digest, CIDR | Secret 평문, 사용자 Token, AWS access key |
| tfvars | 로컬 비밀 제외, gitignore 대상, CI Secret Store에서 주입 | Repository commit 또는 PR 본문 첨부 |
| Output | ALB DNS, CloudFront domain, resource ID, image digest | password, private key, Secret 값 |
| Tag | `project`, `environment`, `managed-by`, `ttl`, `owner` | 사용자 ID, 이메일, Token |

`ttl`은 삭제 예정 시각(UTC ISO-8601)이며, 자동 삭제를 아직 구현하지 않았더라도 Runbook과 결과 보고서에서 사람이 확인하는 필수 값이다.

## 4. B. 배포 입력·검증 경계

Terraform은 애플리케이션 소스 Build를 수행하지 않는다. CI가 테스트·Build를 끝낸 뒤 다음의 불변 입력만 넘긴다.

1. ECR image digest
2. Vite static asset 배포 버전 또는 S3 object prefix
3. 검증 environment 이름·TTL·Region
4. 기존 Secret ARN과 Cognito/Domain 설정의 참조 ID

`latest` tag, 로컬 Docker image, 현재 Git branch 이름을 EC2 배포 입력으로 사용하지 않는다. Apply 결과에는 commit SHA와 image digest를 기록해 부하·장애·비용 결과를 재현할 수 있게 한다.

Terraform Provider는 검증 account ID와 Region을 data source/variable validation으로 확인해야 한다. 허용되지 않은 account ID, Region, `environment=production`이 들어오면 Plan 단계에서 실패한다.

## 5. I. 비용·리소스 생명주기

### 5.1 비용 안전장치

| 시점 | 안전장치 | 통과 조건 |
|---|---|---|
| bootstrap 전 | account ID·Region·예산 확인 | 검증 계정과 Region이 문서에 기록됨 |
| bootstrap | 80,000원·100,000원 Budget Alarm | Alarm 대상·이메일/notification 경로 확인 |
| verification plan | 비용이 있는 리소스와 Tag Review | NAT, ALB, RDS, MSK, ElastiCache, OpenSearch 수량이 승인 범위 |
| apply 직후 | TTL·생성 시각·owner 기록 | 모든 비용 리소스에 표준 Tag 존재 |
| destroy 뒤 | Tag inventory·Cost Explorer 확인 | 잔여 비용 리소스 0건 또는 보존 승인 목록 |

Budget Alarm은 비용을 자동으로 중단시키지 않는다는 점을 명시한다. 100,000원 경고는 다음 검증 실행을 멈추는 신호이며, 이미 생성한 리소스의 삭제 여부를 사람이 확인해야 한다.

### 5.2 삭제 책임

| 계층 | destroy 대상 | 남겨도 되는 대상 |
|---|---|---|
| verification | VPC, NAT, ALB, ASG/EC2, RDS, MSK, ElastiCache, OpenSearch, S3 test Bucket, CloudWatch 검증 리소스 | 승인된 최종 Snapshot·Log 보존 목록만 |
| bootstrap | 기본적으로 삭제하지 않음 | state Bucket, lock table, Budget Alarm, OIDC Role |
| local | Terraform 대상 아님 | Docker volume은 개발자가 별도 관리 |

S3 object version·delete marker, ECR image, Elastic IP, NAT Gateway, VPC Endpoint, RDS Snapshot, CloudWatch Log Group은 provider destroy 뒤에도 비용이 남을 수 있다. Runbook의 Tag inventory를 삭제 성공의 최종 기준으로 사용한다.

## 6. T. 검증 계획

| 테스트 | 방법 | 기대 결과 |
|---|---|---|
| Format/validate | `terraform fmt -check`, `terraform validate` | 문법·Module 입력 오류 없음 |
| Account/Region guard | 허용·비허용 variable 조합 Plan | 허용 환경만 Plan 가능 |
| State isolation | bootstrap/verification backend key 검사 | 서로의 resource를 state에서 보지 않음 |
| Secret guard | `terraform show -json`과 CI Log 점검 | Secret 값이 output/state/Log에 없음 |
| Tag contract | `terraform plan -json` parsing test | 비용 리소스에 표준 Tag·TTL 존재 |
| Destroy rehearsal | 최소 verification 환경 apply/destroy | 잔여 Tag resource 0건 또는 승인 목록 |
| Budget | AWS Console/API 읽기 검증 | 두 Budget Alarm의 금액·범위가 일치 |

Terraform code가 생기기 전에는 format/validate/plan 결과를 만들지 않는다. 그 대신 이 문서의 경계와 #87 Runbook을 code review 기준으로 사용한다.

## 7. 완료 조건

- [x] Docker 로컬 환경과 AWS Terraform 검증 환경의 책임을 분리했다.
- [x] bootstrap·verification state 분리와 state 보안·잠금·삭제 규칙을 정했다.
- [x] account/Region guard, image digest, Secret·Tag·TTL 입력 계약을 정했다.
- [x] 월 10만 원 예산과 비용 리소스 삭제 완료 판정 기준을 정했다.
- [x] #34 이후 Terraform 구현의 자동 검증 기준을 정했다.
