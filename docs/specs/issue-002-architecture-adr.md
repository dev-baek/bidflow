# [Issue #2] EC2 이벤트 기반 아키텍처와 ADR

- 상태: Review
- 작성일: 2026-07-29
- 상위 Issue: [#2 아키텍처와 ADR 작성](https://github.com/dev-baek/bidflow/issues/2)
- 전환 사양: [#107 EC2·ALB 기반 아키텍처 전환 사양 작성](https://github.com/dev-baek/bidflow/issues/107)
- 선행 사양: [Issue #1 프로젝트 범위와 성공 기준](./issue-001-project-scope.md)

## 1. 결정

BidFlow는 Vite 정적 프론트엔드와 Spring Boot 장기 실행 백엔드를 분리한다.

- 프론트엔드: S3에 저장하고 CloudFront로 제공한다.
- 백엔드 진입점: 인터넷 공개 ALB가 HTTPS, 상태 검사와 부하 분산을 담당한다.
- 애플리케이션: Private Subnet의 EC2 Auto Scaling Group에서 Spring Boot를 실행한다.
- 배포 Artifact: Spring Boot OCI Image를 ECR에 저장한다.
- 최종 데이터: RDS PostgreSQL을 거래 원장으로 사용한다.
- 비동기 처리: MSK Serverless Kafka를 경매별 순서가 필요한 명령과 도메인 이벤트에 사용한다.
- 활성 계산·실시간 전파: ElastiCache Redis를 원자 계산과 EC2 간 Pub/Sub에 사용한다.
- 검색: OpenSearch를 PostgreSQL과 이벤트로 복구 가능한 파생 인덱스로 사용한다.
- 운영: CloudWatch, Systems Manager와 Auto Scaling으로 관측·접속·복구한다.
- Nginx, API Gateway, Lambda와 DynamoDB는 MVP 런타임에서 사용하지 않는다.

## 2. 전체 구조

```text
Browser ── static ──▶ CloudFront ──▶ Private S3
   │
   ├── login ───────▶ Cognito
   │
   └── HTTPS/WSS ───▶ Public ALB
                           │ Health Check / Routing
                           ▼
                 EC2 Auto Scaling Group
                 Spring Boot REST / WS / Workers
                    │       │       │       │
                    ▼       ▼       ▼       ▼
                   RDS     MSK    Redis  OpenSearch
                PostgreSQL Kafka
```

프론트엔드는 `app.<domain>`을 사용하고 백엔드는 `api.<domain>`을 사용한다. CORS는 `app.<domain>`만 허용한다. CloudFront를 동적 API의 추가 Proxy로 사용하지 않는다.

## S. 화면과 실시간 연결

### S.1 정적 화면

Vite Production Build 결과인 `apps/web/dist`를 Private S3 Bucket에 배포한다. S3 직접 공개는 금지하고 CloudFront Origin Access Control로만 읽을 수 있게 한다.

- 정적 Asset은 Content Hash와 장기 Cache를 사용한다.
- `index.html`은 짧은 Cache 또는 배포 시 무효화를 사용한다.
- SPA 경로의 403·404는 `/index.html`로 연결한다.
- API 주소는 Build 환경변수 `VITE_API_BASE_URL`로 주입한다.
- WebSocket 주소는 `VITE_WS_BASE_URL`로 주입한다.
- `VITE_` 변수에는 Secret을 넣지 않는다.

### S.2 REST와 WebSocket

- REST: `https://api.<domain>/api/...`
- WebSocket: `wss://api.<domain>/ws`
- REST 인증: Cognito Access Token을 Spring Security Resource Server가 검증한다.
- WebSocket 인증: STOMP `CONNECT` Header의 Access Token을 검증한다.
- ALB Idle Timeout보다 짧은 주기의 Heartbeat를 사용한다.
- 연결이 끊기면 지수 Backoff로 재연결하고 REST 상태 조회로 누락 상태를 보정한다.

ALB는 연결된 EC2를 결정하지만, 입찰 결과가 어느 EC2에서 처리될지는 보장하지 않는다. 각 EC2는 Redis Pub/Sub을 구독하고 자신에게 연결된 Browser에 결과를 전송한다. Pub/Sub 메시지는 영구 원장이 아니므로 재연결 시 PostgreSQL 상태를 조회한다.

## D. 데이터와 정합성

### D.1 PostgreSQL 최종 원장

RDS PostgreSQL은 다음 데이터의 최종 원장이다.

- 사용자 참조 정보
- 상품과 경매
- 자동 입찰 설정
- 입찰 요청과 처리 상태
- 입찰 원장
- 경매 종료와 낙찰 결과
- Outbox Event
- Consumer 멱등 처리 기록

관계형 데이터베이스를 선택하는 이유는 상품·경매·입찰·낙찰 관계, 조건부 상태 변경과 트랜잭션 경계를 명시적으로 보여주기 위해서다. Spring Data JPA는 단순 CRUD에 사용하고 동시성 제어·대량 조회·잠금 Query는 명시적인 SQL과 실행 계획으로 검증한다.

### D.2 Transactional Outbox

DB 상태 변경과 Kafka 발행을 직접 이중 쓰기하지 않는다.

1. 업무 상태와 Outbox Row를 하나의 PostgreSQL Transaction으로 저장한다.
2. Outbox Publisher가 미발행 Row를 `FOR UPDATE SKIP LOCKED`로 가져온다.
3. Kafka 발행 성공 후 Outbox 상태를 갱신한다.
4. Publisher 장애 시 같은 Row를 다시 발행할 수 있다.
5. Consumer는 `eventId`를 기준으로 중복 처리를 막는다.

Exactly-once 전달을 주장하지 않는다. At-least-once 전달과 멱등 Consumer로 동일한 최종 결과를 만든다.

### D.3 Redis

Redis는 다음 목적으로만 사용한다.

- 활성 경매의 자동 입찰 최대 금액과 현재 계산 상태
- Lua Script 기반 다중 Key 원자 변경과 재시도 결과 고정
- API 요청 제한과 짧은 TTL 데이터
- EC2 인스턴스 간 WebSocket 결과 Pub/Sub

Redis는 최종 원장이 아니다. PostgreSQL 입찰 원장과 자동 입찰 설정으로 활성 상태를 재구성할 수 있어야 한다. Redis Pub/Sub 유실은 Browser의 REST 재조회로 보정한다.

Kafka는 같은 `auctionId` 명령의 처리 순서를 보장하고, Redis Lua는 한 명령이 변경하는 최고 입찰자·현재가·자동 입찰 상태가 부분 반영되지 않도록 한다. Lua Script는 `bidRequestId`를 함께 저장해 동일 요청 재시도 시 최초 계산 결과를 반환한다.

Redis 반영 후 PostgreSQL Transaction이 실패하면 Kafka Message를 Commit하지 않는다. 재처리된 동일 요청은 Redis에 고정된 결과를 받아 PostgreSQL에 다시 저장한다. Redis 자체가 유실되면 PostgreSQL의 확정 원장으로 상태를 복구한 뒤 아직 확정되지 않은 입찰 명령을 다시 처리한다.

### D.4 OpenSearch

OpenSearch는 상품 전문 검색, Filter와 정렬을 위한 파생 저장소다.

- 상품·경매 변경 이벤트를 Kafka Consumer가 색인한다.
- 문서 ID는 상품 ID로 고정해 반복 색인을 멱등하게 만든다.
- PostgreSQL Snapshot으로 전체 재색인할 수 있어야 한다.
- OpenSearch 장애는 상품 원본 저장과 입찰 처리를 중단시키지 않는다.

## B. 백엔드

### B.1 Spring Boot Process

하나의 Spring Boot Codebase를 동일한 OCI Image로 배포한다. Process 역할은 Profile로 분리한다.

| 역할 | Profile | 책임 |
|---|---|---|
| API | `api` | REST, WebSocket, Cognito JWT 검증 |
| Bid Worker | `bid-worker` | `bid-command` 소비, 자동 입찰 계산과 결과 저장 |
| Projection Worker | `projection-worker` | 검색 색인과 실시간 결과 발행 |
| Scheduler | `scheduler` | 마감 경매 조회와 종료 명령 발행 |

MVP 검증 환경에서는 한 EC2 Process가 모든 Profile을 실행할 수 있다. 부하 검증에서는 API와 Worker를 별도 Auto Scaling Group으로 분리할 수 있어야 한다. Domain과 Application Code는 Profile에 의존하지 않는다.

### B.2 요청 흐름

#### 상품 등록

1. Browser가 Spring Boot API에서 Presigned URL을 발급받는다.
2. Browser가 이미지를 S3에 직접 업로드한다.
3. 상품·경매와 Outbox Event를 PostgreSQL Transaction으로 저장한다.
4. Outbox Publisher가 `ListingPublished`를 Kafka에 발행한다.
5. Projection Worker가 OpenSearch를 갱신한다.

#### 입찰

1. API가 Cognito JWT, 입력값과 경매 참여 권한을 검증한다.
2. `bidRequestId`와 입찰 요청을 PostgreSQL에 멱등하게 저장한다.
3. Outbox Publisher가 `auctionId`를 Key로 `bid-command` Topic에 발행한다.
4. Bid Worker가 동일 경매의 메시지를 Partition 순서로 소비한다.
5. 순수 Domain 함수와 Redis Lua Script가 입찰 결과를 계산한다.
6. 입찰 원장, 경매 현재가와 결과 Outbox Event를 하나의 DB Transaction으로 저장한다.
7. Projection Worker가 Redis Pub/Sub에 실시간 결과를 발행한다.
8. 모든 API EC2가 자신에게 연결된 Browser에 WebSocket으로 전달한다.

#### 경매 종료

장기 실행 Spring Boot를 사용하므로 경매마다 EventBridge Schedule을 만들지 않는다.

1. Scheduler가 짧은 주기로 `end_at <= now()`이고 진행 중인 경매를 조회한다.
2. `FOR UPDATE SKIP LOCKED`로 여러 Scheduler의 중복 종료를 방지한다.
3. 종료 상태와 `AuctionClosed` Outbox Event를 하나의 Transaction으로 저장한다.
4. 중복 실행은 이미 종료된 상태를 반환하고 추가 낙찰자를 생성하지 않는다.
5. 자동 연장으로 `end_at`이 변경되면 이후 Polling에서 새 종료 시각을 사용한다.

### B.3 순수 함수와 경계

- 입찰 가격 계산, 승인·거절, 자동 연장과 낙찰 판정은 순수 함수다.
- 현재 시각은 `Clock` 또는 `Instant`로 주입한다.
- UUID, 난수와 외부 설정은 명시적인 입력 또는 Port로 주입한다.
- Spring MVC, JPA, Kafka, Redis와 OpenSearch는 Adapter에만 위치한다.
- Controller, Listener와 Scheduler에 업무 규칙을 작성하지 않는다.

## I. AWS 인프라

### I.1 Network

- ALB: 두 Public Subnet에 배치한다.
- EC2 Auto Scaling Group: 두 Private Application Subnet에 배치한다.
- RDS와 ElastiCache: Private Data Subnet Group에 배치한다.
- MSK Serverless와 OpenSearch Serverless: Private Subnet의 VPC Endpoint를 통해 접근한다.
- EC2에는 Public IP와 SSH Inbound Rule을 만들지 않는다.
- ALB Security Group은 Viewer HTTPS만 허용한다.
- EC2 Security Group은 ALB Security Group에서 오는 Application Port만 허용한다.
- Data Security Group은 EC2 Security Group에서 필요한 Port만 허용한다.
- 운영 접속은 Systems Manager Session Manager를 사용한다.

검증 환경에서는 비용 절감을 위해 NAT Gateway 수를 1개로 제한할 수 있다. 이 구성은 NAT Gateway 장애 시 다른 AZ의 EC2도 외부 통신이 불가능한 비용 우선 구성임을 문서에 표시한다. 상용 기준은 AZ별 NAT Gateway다.

RDS는 검증 환경에서 Single-AZ를 사용하고 Snapshot 복원을 검증한다. 상용 기준은 Multi-AZ다. Schema는 Flyway Migration으로만 변경한다.

### I.2 ALB와 Auto Scaling

- ALB Listener: HTTPS 443
- Route 53 Alias가 `api.<domain>`을 ALB로 연결한다.
- ACM Certificate로 Viewer HTTPS를 종료한다.
- Target Protocol: HTTP
- Health Check: `/actuator/health/readiness`
- Liveness와 Readiness를 분리한다.
- Target이 Readiness에 실패하면 ALB가 신규 요청을 전달하지 않는다.
- Auto Scaling Group은 최소 1, 기본 1, 최대 2로 시작한다.
- 부하 실험에서 2대로 확장하고 분산·WebSocket·Consumer 동작을 검증한다.
- 종료 시 Connection Draining과 Spring Graceful Shutdown을 사용한다.

### I.3 배포

1. GitHub Actions가 Test와 Build를 실행한다.
2. OCI Image를 ECR에 Push한다.
3. Image Digest를 배포 입력으로 기록한다.
4. Launch Template의 새 Version을 생성한다.
5. Auto Scaling Instance Refresh로 새 Image를 배포한다.
6. ALB Readiness 통과 후 기존 Instance를 종료한다.
7. 실패하면 이전 Launch Template Version으로 되돌린다.

GitHub Actions는 장기 Access Key 대신 GitHub OIDC와 IAM Role을 사용한다. EC2에는 ECR Pull, CloudWatch, SSM과 필요한 Data Service 접근만 허용하는 Instance Profile을 부여한다.

Database Password와 외부 연동 Secret은 Secrets Manager에서 읽는다. AMI, User Data, GitHub Repository와 Terraform Variable 기본값에 Secret을 저장하지 않는다.

### I.4 Nginx를 사용하지 않는 이유

ALB가 HTTPS 종료, Health Check, 경로 라우팅, WebSocket과 여러 EC2 분산을 담당한다. 하나의 Spring Boot 애플리케이션 앞에 Nginx를 추가하면 Proxy Hop, 설정과 장애 지점만 증가한다.

다음 요구가 실제로 생기면 Nginx를 다시 검토한다.

- 한 EC2에서 여러 독립 애플리케이션을 경로별로 Routing
- 인스턴스 내부 Blue/Green Upstream 전환
- ALB가 제공하지 않는 세밀한 Request Buffering 또는 Cache

현재 MVP에는 해당 요구가 없으므로 사용하지 않는다.

### I.5 비용

- 월 예산 상한은 100,000원이다.
- ALB, EC2, NAT Gateway, RDS, MSK, ElastiCache와 OpenSearch를 상시 운영하지 않는다.
- 로컬 개발은 Docker 기반 PostgreSQL, Kafka, Redis와 OpenSearch를 사용한다.
- AWS 통합 검증은 Terraform으로 생성하고 검증 당일 삭제한다.
- `terraform destroy` 이후 EBS, Snapshot, Elastic IP, NAT Gateway, ALB와 Log Group을 별도로 점검한다.
- AWS Budget 80,000원 경고와 100,000원 초과 경고를 설정한다.
- 비용 보고서는 서비스별 실행 시간과 실제 청구 금액을 기록한다.

MSK Serverless는 Traffic이 없어도 Cluster Hour와 Partition Hour 비용이 발생하므로 실행 시간을 별도로 기록한다.

## T. 검증

### T.1 Architecture Test

- `domain`은 Spring, AWS SDK와 Persistence Dependency를 참조하지 않는다.
- `application`은 외부 Adapter 구현을 참조하지 않는다.
- Controller, Kafka Listener와 Scheduler가 Domain 함수를 직접 복제하지 않는다.
- Flyway Migration과 JPA Mapping이 일치한다.

### T.2 Integration Test

- PostgreSQL·Redis·Kafka·OpenSearch는 Testcontainers로 검증한다.
- Outbox Publisher 재시도 시 같은 Event가 중복 반영되지 않는다.
- Kafka Consumer 재시작 후 처리하지 않은 Event를 이어서 처리한다.
- Redis 초기화 후 PostgreSQL에서 활성 경매 상태를 복구한다.
- OpenSearch 전체 재색인이 동일 문서를 중복 생성하지 않는다.

### T.3 AWS 검증

- ALB가 Readiness 실패 Instance로 신규 요청을 보내지 않는다.
- EC2 한 대 종료 시 Auto Scaling Group이 새 Instance를 생성한다.
- Instance Refresh 동안 API 가용성을 확인한다.
- 두 EC2 중 어느 Instance에서 입찰을 처리해도 연결된 Browser가 결과를 받는다.
- WebSocket 재연결 후 REST 조회로 최종 상태를 복구한다.
- Terraform Destroy 후 비용 발생 리소스가 남지 않는다.

## 8. 대안

### API Gateway·Lambda

간헐적 요청에는 비용 효율적이지만 Spring Boot 장기 실행, Kafka Consumer, EC2 운영과 배포 경험을 보여주려는 목표와 맞지 않아 제외한다.

### Nginx·단일 EC2

구성이 단순하고 Nginx 경험을 얻을 수 있지만 단일 장애 지점, 수동 인증서·상태 검사와 확장 한계가 있어 제외한다.

### ALB·EC2·Nginx·Spring Boot

여러 EC2의 분산은 ALB, 인스턴스 내부 Proxy는 Nginx가 담당할 수 있다. 현재는 인스턴스당 애플리케이션이 하나라 역할이 중복되므로 제외한다.

### DynamoDB

조건부 쓰기와 수평 확장은 장점이지만 이번 프로젝트는 관계, Transaction, SQL 실행 계획과 Spring Data 경험을 보여주는 것이 더 중요해 RDS PostgreSQL을 선택한다.

## 9. 변경 대상

본 사양 승인 후 다음을 수정한다.

- Epic #2 제목과 본문
- Lambda·API Gateway·DynamoDB를 전제로 한 Sub-issue
- Issue #1 프로젝트 범위 사양
- Issue #3 저장소와 로컬 개발 사양
- Terraform 배포, 관측성, 부하와 장애 실험 이슈

기존 Issue 번호와 주차는 가능한 한 유지한다. 의미가 완전히 사라진 이슈는 삭제하지 않고 `not planned`로 종료한 뒤 대체 이슈를 연결한다.

## 10. 참고 자료

- [CloudFront Cache Behavior](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/DownloadDistValuesCacheBehavior.html)
- [CloudFront WebSocket](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/distribution-working-with.websockets.html)
- [ALB Target Group](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/load-balancer-target-groups.html)
- [ALB Health Check](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/target-group-health-checks.html)
- [EC2 Auto Scaling](https://docs.aws.amazon.com/autoscaling/ec2/userguide/auto-scaling-benefits.html)
- [Amazon MSK Pricing](https://aws.amazon.com/msk/pricing/)
