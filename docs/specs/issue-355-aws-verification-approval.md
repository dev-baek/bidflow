# [Issue #355] AWS 검증 실행·비용 승인 요청서

- 작업: [#355 승인 준비](https://github.com/dev-baek/bidflow/issues/355). 실제 배포는 [#356](https://github.com/dev-baek/bidflow/issues/356), 삭제와 청구 확인은 [#357](https://github.com/dev-baek/bidflow/issues/357).
- 참고: [배포·삭제 Runbook](issue-017-aws-deployment.md), [산출물·필수 입력 점검](issue-354-deployment-artifacts.md).
- 상태: 승인 요청 초안. 이 문서나 PR의 병합은 AWS 접속·리소스 생성·삭제 승인이 아니다.

## S. 요청 범위

도쿄(`ap-northeast-1`)의 검증 전용 계정에서 **1회**, 최대 6시간의 검증을 제안한다. 시작 후 4시간부터 정리를 시작하고 6시간 이내 삭제 증적을 남기는 것이 목표다. 시작·정리·종료 시각은 JST와 UTC를 함께 기록한다. 사람이 종료할 수 있는 검증 창에만 시작하며 상시 운영하지 않는다.

검증 목표는 실제 Cognito 로그인 → 이미지 업로드 → 상품·경매 등록 → OpenSearch 검색 → MSK 입찰 처리 → Redis 실시간 갱신 → PostgreSQL 원장·최종 결과 대조다. 가짜 계정과 데이터만 사용한다. 대량 부하·장애 주입·상시 환경·신규 도메인 구입은 포함하지 않는다. CloudWatch 실제 알림은 [#359](https://github.com/dev-baek/bidflow/issues/359)의 범위와 승인이 맞을 때만 같은 실행 창에 넣는다.

## I. 승인과 실행의 구분

| 단계 | 필요한 확인 | 허용 범위 |
|---|---|---|
| 준비 | 계정 별칭, 승인자·실행자·정리 책임자, 시간 창, 포함 서비스, 비용과 정리 예외 | 공개 단가 조회와 로컬 준비만. 이번 #355의 범위 |
| 접근·Plan 승인 | 검증 전용 계정·도쿄, 사용자 소유의 단기 IAM Identity Center/Role, 정리 권한 | 승인 후 계정/리전 대조, 사용량·알림·입력 확인, 합의한 원격 state와 Plan. 아직 생성하지 않음 |
| 적용 승인 | 사람이 Plan과 비용을 확인; EC2 보류 단계와 활성화 단계 각 변경 범위 대조 | 승인된 Apply·스모크에 한정. 검증 시작 전에 #357 대상과 실패 시 정리까지 승인 |
| 종료 | 실제 Terraform·태그/서비스별 잔존 목록 | #357에서 삭제 성공·실패를 구분하고, 청구가 반영된 뒤 실비 재확인 |

장기 Access Key·비밀번호를 채팅이나 Git에 제공하지 않는다. 승인 전에는 계정을 조회하지 않는다. 검증 VPC 안의 임시 ARM64 운영 클라이언트 한 대를 계상한다. SSM 세션, 기존 사설 경로 및 해당 검증 리소스에만 권한을 주어 MSK 토픽과 OpenSearch 인덱스·alias를 먼저 준비한다. 준비 경로나 역할을 확보하지 못하면 앱 권한을 늘리거나 공개 접근을 추가하지 않고 실행을 미룬다.

## D. 비용 추정

2026-11-26 JST 기준 AWS 도쿄 공개 온디맨드 단가를 참고한다. 통화는 USD이고, **1달러=1,600원, 세금·환전 비용 여유 15%**는 비교를 위한 보수적 가정이지 실시간 환율이나 청구 확정이 아니다. 무료 크레딧·할인·프리 티어는 0으로 본다. 가능한 자원을 실제로는 나중에 만들더라도 모두 6시간 유지로 근사한다.

| 항목 | 사용 가정 | 적용 USD/시간 |
|---|---|---:|
| 앱 EC2 + 임시 운영 클라이언트 | `t4g.small` 2대 × $0.05 + `t4g.micro` 1대 × $0.03, 계획용 상향 가정 | 0.1300 |
| RDS PostgreSQL | `db.t4g.micro` Single-AZ 1대. 스토리지는 아래 예비비 | 0.0250 |
| ALB | 1대 $0.0243 + 평균 1 LCU $0.008 가정 | 0.0323 |
| NAT + 공인 IPv4 | NAT 1개 $0.10 계획용 가정 + IPv4 3개 × $0.005 가정. 처리량은 예비비 | 0.1150 |
| MSK Serverless | 클러스터 $0.9675 + 토픽 6개 × 3 파티션 × $0.0019 | 1.0017 |
| ElastiCache Redis | `cache.t4g.micro` Redis 1대 | 0.0250 |
| OpenSearch | `t3.small.search` 1대. 스토리지는 예비비 | 0.0560 |
| **합계** | 사용량 기반 항목 제외 | **1.3850** |

사용량 기반 비용 예비비는 **$5**로 둔다. EC2 디스크(앱 2×20 GiB와 운영 클라이언트 디스크), RDS·OpenSearch 디스크, S3/ECR, Secrets Manager·Cognito, CloudFront, NAT/전송·MSK I/O·CloudWatch·로그, 사전 준비된 DNS 및 bootstrap state/lock의 단기 사용을 포함한다. 이 금액은 가격 확정이나 상한이 아니다. 테스트 사용자 2명, 소량의 가짜 데이터, 서비스별 전송·로그 1 GB 이내를 가정한다. CPU 크레딧, ALB IP·LCU 증가, 계정 기존 지출·세금·삭제 지연이 있으면 다시 산정한다.

- **6시간:** `(1.385 × 6 + 5) × 1.15 × 1,600 = 24,490.40원` → 약 **2.5만 원** 계획치.
- **12시간 지연 비교:** 같은 가정에서 약 **4만 원**. 연장 승인이 아니며, 초과 또는 예상 밖 자원은 즉시 생성·검증을 멈추고 정리한다.
- 6시간 기준을 넘을 우려가 있거나 별도 확인 후 이번 실행 예측이 **3만 원**을 넘으면 적용 전에 다시 승인을 받는다. 최초 접근 승인 후 AWS Pricing Calculator와 해당 계정/Plan에서 입력·가격을 다시 확인한다.

공개 단가: [RDS 도쿄](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonRDS/20261124233028/ap-northeast-1/index.json), [ELB 도쿄](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSELB/20261125185832/ap-northeast-1/index.json), [VPC 도쿄](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonVPC/20261125055256/ap-northeast-1/index.json), [MSK 도쿄](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonMSK/20261117194558/ap-northeast-1/index.json), [ElastiCache 도쿄](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonElastiCache/20261125150226/ap-northeast-1/index.json), [OpenSearch 도쿄](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonES/20261125150246/ap-northeast-1/index.json). EC2·NAT 계획 가정은 요금표 확정치와 구분한다.

## T. 차단·정리 및 체크리스트

- [ ] 사용자 승인으로 계정 별칭·실행자/정리 담당·검증 창/UTC TTL·예상 비용·실행 기능을 확정한다. UTC TTL 태그만으로 자동 삭제되지 않는다.
- [ ] 월 **8만 원·10만 원** 실제/예측 알림과 수신자를 확인한다. 예산 단위는 계정에서 지원하는 단위로 확인하고 필요 시 보수적으로 환산한다. Terraform 기본값을 계정 검증 없이 적용하지 않는다. [AWS Budgets 알림 지연](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-managing-costs.html) 때문에 알림은 차단 장치가 아니다. 월 기존 지출과 남은 여유가 부족하면 실행하지 않는다.
- [ ] [#354](https://github.com/dev-baek/bidflow/issues/354)의 로컬 ARM64 검증, DNS/인증서·AMI·게시 입력, 임시 사설 운영 클라이언트, backend와 대상 리소스 목록을 확인한다. 자격 증명과 계정별 파일은 저장소 밖에 둔다.
- [ ] 검증 실패, 추가 비용·예상 밖 리소스, 권한 범위 불일치 또는 정리 시각 도달 시 추가 생성은 멈추고 #357로 넘어간다. 삭제 실패는 즉시 담당자에게 알리고, 비용 잔존·보존 합의와 추후 청구 확인일을 기록한다.

현재 제공된 것은 공개 단가를 기반으로 한 승인 초안뿐이다. 계정·예산·시간 창·공개 DNS/ACM·AMI·게시 역할·사설 클라이언트의 실제 준비는 미확인이다.
