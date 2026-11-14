# [Issue #87] AWS 검증 환경 배포·삭제 Runbook

- 상태: 제안됨
- 관련 Issue: [#87 AWS 검증 환경 배포·삭제 Runbook 작성](https://github.com/dev-baek/bidflow/issues/87)
- 선행 구현: #33 Terraform 환경 정책, #34 Terraform State, #35 Network, #36 IAM, #37 Budget, #88 ALB·EC2·RDS·S3, #89 관리형 데이터 서비스
- 후속 검증: #91 Smoke Test·Destroy, #92 CloudWatch Dashboard·Alarm

## 1. 목적과 원칙

이 Runbook은 BidFlow를 상시 운영하기 위한 배포 절차가 아니다. 로컬 Docker에서 검증한 계약을 AWS 관리형 서비스에서도 짧게 확인하고, 결과·비용을 기록한 뒤 모든 비용 리소스를 삭제하기 위한 절차다.

- 월 예산 상한은 **100,000원**이다. 80,000원과 100,000원 Budget Alarm이 없으면 생성하지 않는다.
- Terraform과 실행 계정은 검증 전용 환경·Region만 대상으로 한다. 기본 프로파일이나 개인 운영 계정에 적용하지 않는다.
- `apply` 전 변경 목록을 사람이 읽고 승인한다. `-auto-approve`는 사용하지 않는다.
- `destroy` 실패나 잔여 리소스는 성공으로 처리하지 않는다.
- 실제 생성 전에는 AWS 배포 완료, MSK 운영 경험, 성능 달성을 포트폴리오에 적지 않는다.

현재 저장소에는 AWS Terraform Module이 아직 없다. 따라서 아래의 `terraform` 명령은 #34·#88·#89에서 실제 디렉터리와 변수 검증이 구현된 뒤에만 실행한다. 이 문서는 그 구현의 계약과 검증 순서를 고정한다.

## 2. S. 사용자와 운영자 흐름

| 단계 | 운영자 행동 | 사용자에게 허용되는 상태 |
|---|---|---|
| 배포 전 | 로컬 테스트·예산·Plan·변수 파일 확인 | 서비스는 AWS에서 제공하지 않음 |
| 생성 | Foundation → Runtime → Data 순서로 Apply | 초기화·배포 중, 공개 URL을 공유하지 않음 |
| Smoke Test | 등록·검색·입찰 접수·처리·종료 확인 | 테스트 계정과 Fixture만 사용 |
| 부하/장애 | k6, Lag, SQL 불변식, 장애 격리 수집 | 의도적 장애로 일부 기능 지연/오류 가능 |
| 삭제 | Runtime → Data → Foundation 순서로 Destroy | 검증 종료, URL과 서비스 접근 불가 |

검증 환경에는 실제 결제·개인정보·실사용 이미지·운영 Cognito 사용자를 넣지 않는다. 모든 계정·상품·이미지는 테스트 전용이며, 공개 DNS를 만들더라도 테스트 종료 뒤 삭제한다.

## 3. D. 상태·비용 데이터와 보존

| 데이터 | 위치 | 생성/삭제 기준 |
|---|---|---|
| Terraform state | 원격 Backend, 버전 관리·잠금 | #34가 암호화·잠금·최소 권한을 구현한 뒤 사용; 임의 삭제 금지 |
| PostgreSQL | RDS 검증 인스턴스 | 테스트 데이터만 저장; destroy 뒤 최종 Snapshot 보존 여부를 사전 선택 |
| 이미지 | S3 검증 Bucket | 테스트 Prefix만 사용; Destroy 전 버전·삭제 마커를 포함해 비움 |
| Kafka Event/Consumer offset | MSK 검증 Cluster | 검증 기록 후 Cluster 삭제; 장기 보관하지 않음 |
| Redis/OpenSearch | 검증용 관리형 서비스 | 파생 데이터이므로 PostgreSQL/Event로 재생 가능해야 함 |
| CloudWatch Log/Metric | Log Group/Dashboard/Alarm | 보존 기간을 명시하고 Destroy 뒤 잔여 Log Group 확인 |
| 실행 증적 | `docs/reports` | commit SHA, 시각, 환경, 결과, 실제 비용만 보관; Secret 제외 |

RDS Snapshot을 남기면 비용이 계속 발생한다. 검증 시작 전에 `keep_final_snapshot`을 명시하고, 기본값은 **보존하지 않음**으로 한다. 포트폴리오 목적으로 보존이 필요하면 Snapshot ID와 삭제 예정일을 결과 보고서에 기록한다.

## 4. B. 배포 Artifact와 실행 계약

1. CI가 Java·frontend 테스트와 Build를 수행한다.
2. Spring Boot OCI Image는 ECR에 Push하고 **image tag가 아닌 digest**를 배포 입력으로 기록한다.
3. Vite `dist`는 Private S3에 배포하고 CloudFront OAC로만 읽게 한다.
4. EC2 Launch Template은 image digest, 실행 profile, Secret 참조만 받는다. User Data·환경 파일·GitHub Actions Log에 Secret을 넣지 않는다.
5. Spring Boot는 `/actuator/health/readiness`가 통과한 뒤에만 ALB Target으로 트래픽을 받는다.
6. 배포 실패 시 새 Instance를 억지로 재시작하지 않고, 직전 Launch Template Version으로 되돌린 뒤 CloudWatch Log와 ALB Target 상태를 수집한다.

환경별 값은 `terraform.tfvars` 또는 Secret Manager에서 주입한다. `VITE_` 환경변수, GitHub Repository Variable, Terraform 기본값에는 비밀값을 저장하지 않는다.

## 5. I. 생성·검증·삭제 절차

### 5.1 생성 전 차단 목록

다음 항목이 하나라도 없으면 `apply`하지 않는다.

- [ ] AWS Budget: 80,000원 경고와 100,000원 경고가 실제 검증 계정·Region에 설정됨
- [ ] Terraform remote state encryption, locking, 검증 workspace가 구현됨
- [ ] 예상 `terraform plan`이 검증용 Tag(`project=bidflow`, `environment=verification`, `ttl`)만 생성함
- [ ] GitHub OIDC Role과 EC2 Instance Profile이 최소 권한이고 장기 Access Key가 없음
- [ ] VPC, public ALB subnet, private application/data subnet, Security Group 흐름이 검토됨
- [ ] RDS/ElastiCache/MSK/OpenSearch의 최소 용량·보존·삭제 정책을 명시함
- [ ] 실행 시작·삭제 예정 시각과 담당자가 보고서에 기록됨

### 5.2 생성 순서

```text
1. Foundation: State, IAM, Budget, VPC, Subnet, Security Group
2. Data: RDS, S3, MSK, ElastiCache, OpenSearch, Secrets
3. Runtime: ECR image, ALB, EC2 ASG, CloudFront, CloudWatch
4. Application: Migration, Runtime health, 테스트 Fixture
```

각 단계 뒤에는 다음을 확인한다.

| 단계 | 확인 | 중단 기준 |
|---|---|---|
| Foundation | Tag·Region·Security Group ingress/egress | Public EC2 IP, 0.0.0.0/0 데이터 포트, 예상 밖 리소스 |
| Data | private endpoint, encryption, Backup/Snapshot 정책 | public database, Secret 평문, 과도한 노드/용량 |
| Runtime | ALB readiness, ECR digest, S3 OAC | health 실패, public S3, image tag만 사용 |
| Application | Flyway, 등록/검색/입찰의 최소 흐름 | 원장 불일치, DLT, 예상 밖 오류율 |

### 5.3 Smoke Test와 실험

Smoke Test는 #91에서 자동화한다. 최소 흐름은 테스트 판매자 로그인 → presigned upload → 상품/경매 등록 → 검색 Projection 확인 → 입찰 접수 → Kafka 처리와 원장 확인 → 경매 종료다.

부하·장애 검증은 [#94 사양](issue-019-load-failure-test.md)을 따른다. 결과에는 k6 JSON, Consumer Lag, SQL 불변식, DLT Header, CloudWatch Log Insight query, 인프라 실행 시간을 함께 남긴다. 단일 실행 실패도 원인과 후속 조치를 보존한다.

### 5.4 삭제 순서

```text
1. 외부 접근 중지: CloudFront/ALB DNS, ASG desired capacity 0 또는 Runtime destroy
2. Runtime 제거: EC2 ASG, Launch Template, ALB, CloudFront, ECR 검증 image
3. Data 제거: OpenSearch, ElastiCache, MSK, RDS, S3 테스트 객체/Bucket
4. Foundation 제거: NAT Gateway, Elastic IP, VPC Endpoint, Security Group, VPC
5. 관측·비용 제거: Dashboard, Alarm, Log Group(보존 정책 확인), Budget 제외 잔여 Tag 점검
```

`terraform destroy`만 실행하고 끝내지 않는다. Provider가 삭제하지 않는 S3 Object version, RDS final Snapshot, ECR image, Elastic IP, NAT Gateway, CloudWatch Log Group, VPC Endpoint를 AWS Console 또는 CLI의 **Tag 기반 조회**로 확인한다. 다른 프로젝트 리소스나 Region 전체를 대상으로 삭제 명령을 실행하지 않는다.

### 5.5 삭제 완료 판정

| 대상 | 완료 증적 |
|---|---|
| Terraform | 검증 workspace `destroy` plan이 0 resources |
| 비용 리소스 | `project=bidflow`, `environment=verification` Tag 조회 결과 0건 또는 보존 승인 목록 |
| S3/ECR/RDS | Object version·image·Snapshot 잔여 여부와 처리 결과 |
| Network | NAT Gateway, Elastic IP, VPC Endpoint, Load Balancer 0건 |
| 관측 | Alarm/Dashboard/Log Group 보존 여부와 비용 영향 |
| 비용 | Cost Explorer에서 검증 일자·서비스별 비용을 결과 보고서에 기록 |

## 6. T. Runbook 검증

| 조건 | 검증 방법 | 통과 기준 |
|---|---|---|
| 잘못된 계정/Region | Terraform provider·workspace guard test | 검증 계정/Region 이외 Plan이 실패 |
| 예상 밖 변경 | `terraform plan` Review | Tag·리소스 목록이 승인 범위와 일치 |
| 배포 정상 | Smoke Test | readiness, 등록, 검색, 입찰 원장 흐름 통과 |
| 배포 오류 | 의도적으로 잘못된 image/Secret 참조 | ALB가 비정상 Target을 받지 않고 rollback 증적 보존 |
| 비용 안전 | Budget Alarm test/Console 확인 | 80,000·100,000원 Alarm 존재와 대상 일치 |
| 삭제 정상 | Destroy 뒤 Tag inventory | 비용 리소스 0건 또는 승인된 보존 목록 |
| 삭제 오류 | versioned S3/Snapshot을 남긴 검증 | 잔여 목록을 보고서에 남기고 재삭제 절차 확인 |

## 7. 결과 보고서 템플릿

```text
실행일/시간(UTC):
Git commit / image digest:
AWS account alias / Region:
생성 리소스와 TTL:
Smoke Test 결과:
부하·장애 결과 및 불변식:
발생한 DLT/오류와 조치:
destroy 시각 / Tag inventory 결과:
보존한 Snapshot·Log와 삭제 예정일:
Cost Explorer 실제 비용:
한계와 다음 실행 변경점:
```

## 8. 완료 조건

- [x] 생성 전 비용·계정·Plan 차단 조건을 정의했다.
- [x] Foundation/Data/Runtime/App 생성 순서와 중단 기준을 정의했다.
- [x] Smoke Test·부하·장애 증적과 실제 비용 기록 항목을 정의했다.
- [x] Tag 기반 삭제·잔여 리소스·Snapshot·Log 확인 절차를 정의했다.
- [x] Terraform 코드 부재와 실제 AWS 검증 전 표현 금지 경계를 명시했다.
