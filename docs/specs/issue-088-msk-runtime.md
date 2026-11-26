# [Issue #88] MSK Serverless 런타임 연결 계약

- 상태: 제안. AWS 접속·리소스 생성·비용을 승인하는 문서가 아니다.
- 작업 이슈: [#88 배포 구성](https://github.com/dev-baek/bidflow/issues/88). [#89](https://github.com/dev-baek/bidflow/issues/89)의 관리형 리소스 생성 모듈을 재사용하고, 실연결·스모크·삭제는 [#91](https://github.com/dev-baek/bidflow/issues/91)에 남긴다.
- 선행: [MSK 모듈](issue-193-msk-verification.md), [첫 배포 순서](issue-088-first-deployment.md), [EC2 부팅 권한](issue-088-runtime-bootstrap-access.md).

## 문제

`enable_managed_kafka=true`로 브로커를 만들 수 있지만 현재 EC2는 bootstrap 주소와 SASL 프로토콜·메커니즘만 받는다. 앱에는 AWS IAM 인증 플러그인 및 필수 Kafka 로그인/콜백 설정이 없고, 런타임 정책은 실제 `bidflow-verification-kafka`가 아닌 추정 이름 `bidflow-verification`을 참조한다. 기존 토픽 스크립트는 로컬 Compose 전용이다. 따라서 Terraform으로 브로커가 생성됐다는 사실만으로 입찰 이벤트가 처리된다고 볼 수 없다.

## S. 사용자와 운영자 흐름

- 화면과 API는 변경하지 않는다. 판매자·입찰자가 보는 등록과 입찰 흐름은 기존 계약을 따른다. 브로커 주소·ARN·인증 설정은 Vite나 브라우저에 전달하지 않는다.
- 실제 #91 실행에서는 EC2를 보류한 첫 단계에 명시적으로 MSK를 켠 뒤, 승인된 VPC 내부 Kafka 클라이언트에서 토픽을 먼저 준비한다. 토픽과 파티션을 검사하고 나서만 EC2를 활성화한다.
- 스모크는 API가 입찰을 접수하는 데서 끝내지 않는다. 같은 `bidRequestId`로 정산 결과·PostgreSQL 원장·이벤트가 일치하는지 확인하고, 경매 키 순서와 재처리 동작은 기존 계약대로 검증한다.

## D. 데이터와 토픽

| 용도 | 이름 | 비고 |
|---|---|---|
| 명령·이벤트 | `bid-command`, `bid-event`, `listing-event` | 경매 키와 도메인 이벤트 형식은 변경하지 않음 |
| 실패 이벤트 | `bid-command.DLT`, `bid-event.DLT`, `listing-event.DLT` | 각 원본과 동일하게 3 파티션 |
| 컨슈머 그룹 | `bid-settlement`, `realtime-projection`, `auction-finalization`, `search-projection` | 기존 런타임 그룹만 허용 |

여섯 토픽 모두 3 파티션, 7일 보존으로 준비한다. 복제 계수는 MSK 서비스 기본값을 사용하고 로컬의 RF=1을 복사하지 않는다. 기존 토픽이 있으면 설정을 확인하고, 불일치는 자동 수정하지 않고 중단한다. [MSK Serverless 보존 설정](https://docs.aws.amazon.com/msk/latest/developerguide/serverless-config.html).

## B. Spring Boot 인증

- 앱 런타임에 AWS의 `aws-msk-iam-auth` 의존성만 추가한다. Java 클라이언트는 `SASL_SSL`과 `AWS_MSK_IAM`, IAM 로그인 모듈 및 콜백 핸들러를 사용한다. 비밀을 JAAS 문자열에 넣지 않고 EC2 역할의 임시 credentials를 사용한다. [AWS의 Java IAM 클라이언트 구성](https://docs.aws.amazon.com/msk/latest/developerguide/configure-clients-for-iam-access-control.html).
- Terraform이 MSK를 켠 경우에만 별도 `msk` 프로필과 전용 bootstrap 변수 `BIDFLOW_MSK_BOOTSTRAP_SERVERS`를 주입한다. Cognito의 `verification` 프로필과 독립적으로 조합하며 둘 다 켜면 함께 활성화한다. `application-msk.yml`에서 Kafka 공통 속성을 주입해 producer·consumer·admin 바인딩을 일치시키고, bootstrap을 누락하면 localhost로 대체하지 않고 실패한다. 로컬 설정에는 IAM과 TLS를 강제하지 않는다.
- MSK가 켜져도 Runtime Secret이 관리 프로필·브로커·Spring Kafka 설정이나 AWS 자격 증명 소스를 덮을 수 없게 기존 부팅 가드를 확장한다. 장기 AWS 키·공유 프로파일을 컨테이너에 마운트하거나 이미지에 넣지 않는다. Kafka client의 토픽 자동 생성에 의존하지 않는다.
- producer 멱등 쓰기를 유지하고, PostgreSQL Outbox·멱등 처리 계약은 그대로 둔다. 이것을 DB와 Kafka 사이의 exactly-once 보장으로 해석하지 않는다.

## I. 인프라와 토픽 준비

- MSK와 EC2 런타임이 둘 다 활성화된 경우에만 앱 역할에 MSK 정책을 붙인다. 실제 생성된 cluster ARN에서 topic/group ARN을 구성해 위 고정 목록만 사용한다. 모듈의 생성 여부는 활성화 스위치로 결정하며, cluster UUID를 Plan 시점에 알 필요가 없어야 한다.
- 앱 정책은 해당 클러스터의 Connect·Describe 및 멱등 쓰기, 지정 토픽의 Describe·Read·Write, 지정 그룹의 Describe·Alter 범위까지만 둔다. Create·DeleteTopic, 토픽 변경, 클러스터 관리자 권한은 주지 않는다. [MSK IAM 권한과 리소스 범위](https://docs.aws.amazon.com/msk/latest/developerguide/kafka-actions.html).
- 컨테이너가 EC2 역할을 쓰도록 MSK 또는 이미지 S3가 켜지면 IMDS 응답 hop limit 2를 사용하되 IMDSv2 토큰은 필수로 유지한다. 브로커는 기존 사설 네트워크에 두며 공인 주소와 인터넷 인바운드는 추가하지 않는다. [컨테이너 IMDSv2 설정](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/configuring-IMDS-new-instances.html).
- #91에서 선택한 임시 VPC 클라이언트와 토픽 준비용 역할을 먼저 승인한다. 브로커로 가는 9098 사설 경로와 동일 검증 클러스터의 토픽 생성·조회 권한만 사용한다. 별도 클라이언트를 준비하지 못하면 EC2 활성화 및 스모크를 미룬다. 서버리스에서 AWS 제어 플레인 토픽 API 대신 IAM 인증 Kafka 도구를 사용한다. [Serverless 토픽 준비](https://docs.aws.amazon.com/msk/latest/developerguide/msk-serverless-create-topic.html), [토픽 API 적용 범위](https://docs.aws.amazon.com/msk/latest/developerguide/msk-topic-operations-information.html).

## T. 구현 전 실패 테스트와 완료 기준

1. Config Data로 읽고 바인딩된 값에서 MSK 프로필만 SASL 설정을 갖고 클래스가 런타임 classpath에 있는지 확인한다. 별도 브로커 없이 producer·consumer·admin 설정과 bootstrap 미설정 실패, Cognito 조합, 로컬 회귀를 검사한다.
2. Terraform mock에서 MSK 비활성화·EC2 보류 상태에는 앱 정책이 없고, 둘 다 활성화되면 실제 클러스터 ARN의 지정 토픽·그룹만 허용하는지 확인한다. 아직 알 수 없는 ARN의 초기 Plan, 설정 충돌 차단, IMDSv2 토큰·hop limit, 이미지 S3 회귀도 확인한다.
3. #91에서만 여섯 토픽의 파티션·보존 설정을 확인하고, 실제 IAM 세션으로 publish/consume과 원장·이벤트 연결, 허용되지 않은 토픽 권한 거부, 클러스터 및 임시 클라이언트의 삭제를 검증한다. 이 전에는 AWS 연결·처리량·비용을 측정했다거나 토픽 준비가 끝났다고 보고하지 않는다.
