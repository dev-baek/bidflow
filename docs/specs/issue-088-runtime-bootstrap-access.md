# [Issue #88] EC2 부팅의 ECR·Secret 권한과 RDS 연결 계약

- 상태: 제안. AWS 접근·배포 권한을 승인하는 문서가 아니다.
- 작업 이슈: [#88 배포 구성](https://github.com/dev-baek/bidflow/issues/88). 실제 EC2 기동과 Target 상태는 [#91](https://github.com/dev-baek/bidflow/issues/91)에서 검증한다.
- 선행: [첫 배포 입력과 실행 순서](issue-088-first-deployment.md), [상품 이미지 S3](issue-088-verification-image-storage.md).

## 문제

첫 배포의 ECR 생성과 EC2 활성화는 #343에서 분리했다. 그러나 앱 역할은 `repository/bidflow-verification`을 허용하는 반면 실제 저장소는 `bidflow-verification-application`이다. Secret 권한도 `secret:bidflow-verification/*`에만 맞춰져 있어, RDS가 생성하는 master Secret과 경로 밖의 유효한 Runtime Secret을 대상으로 보장되지 않는다. 부팅 스크립트는 또 RDS 연결 주소와 포트를 Secret JSON에서 읽고 있어, 해당 키가 없으면 잘못된 JDBC URL을 만든다.

## S. 운영자 확인

1. ECR 준비 단계에서는 기존처럼 EC2 입력 없이 Plan할 수 있다.
2. EC2 활성화 Plan에서 실제 배포 저장소와 필요한 Secret만 앱 역할에 연결되는지 확인한다. 검증 입력 ARN의 계정·리전 제한은 유지한다.
3. 승인된 검증에서는 앱 역할로 ECR에서 지정 digest를 읽고, Secret 값을 출력하지 않은 채 부팅·ALB readiness를 확인한다. 권한 실패를 성공으로 기록하거나 장기 키·관리자 역할로 우회하지 않는다.

## D. 입력의 소유자

| 값 | 출처 | 부팅에서의 용도 |
|---|---|---|
| ECR 저장소 ARN | application edge의 실제 저장소 출력 | EC2 앱 역할의 이미지 읽기 권한 |
| RDS host·port | private RDS 모듈의 endpoint·port 출력 | JDBC URL 구성. Secret JSON의 다른 필드에 의존하지 않음 |
| RDS 사용자·비밀번호 | RDS가 관리하는 정확한 Secret ARN | EC2 부팅 시 `username`, `password`만 읽음 |
| Runtime env-file | 운영자가 제공한 정확한 Runtime Secret ARN | 기존 `KEY=value` 입력 유지 |
| Redis 인증값 | Redis가 활성화된 경우 그 모듈의 정확한 Secret ARN | 기존 Redis TLS 연결 설정 유지 |

EC2 부팅 설정에는 Secret **값**이 아니라 ARN만 전달한다. 기존 Redis 모듈이 생성하는 토큰의 sensitive Plan/state 처리 방식은 변경하지 않는다. RDS endpoint/port 출처는 [RDS 연결 정보 가이드](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/CHAP_CommonTasks.Connect.EndpointAndPort.html)를 따른다.

## B. EC2 부팅 계약

- Docker 로그인에는 ECR registry 호스트만 주고, pull에는 기존 검증 저장소의 전체 `@sha256:` URI를 유지한다. [Docker login의 주소 계약](https://docs.docker.com/reference/cli/docker/login/).
- Terraform이 전달한 RDS endpoint·port와 RDS Secret의 자격 증명으로 JDBC 환경을 구성한다. 없는 값, JSON null 또는 빈 자격 증명은 Docker 실행 전에 일반 오류로 중단한다. 실패 로그에는 Secret 내용이나 AWS 인증 토큰을 넣지 않는다.
- 기존 root 전용 환경 파일, 인증 및 이미지 설정 충돌 차단, IMDSv2 토큰 요구는 유지한다. 로컬 Docker Compose에는 변경을 주지 않는다.

## I. IAM 및 의존 순서

- `ecr:GetAuthorizationToken`의 리소스 예외는 유지하고, 이미지 레이어/manifest 읽기는 **실제 ECR 저장소 ARN 하나**로 한정한다. EC2 역할에는 이미지 push 권한을 추가하지 않는다. [ECR의 리소스별 권한](https://docs.aws.amazon.com/service-authorization/latest/reference/list_ecr.html).
- 경로 와일드카드 대신 부팅 스크립트가 받는 Runtime·RDS·선택형 Redis Secret의 ARN 집합에만 `secretsmanager:GetSecretValue`를 허용한다. EC2가 보류되면 부팅용 Secret 조회 권한을 붙이지 않는다. 다른 계정과 사용자 관리 KMS 키 지원을 추가하지 않으며 광범위한 decrypt 권한도 추가하지 않는다.
- ARN이 Plan 시점에 아직 알려지지 않아도 리소스 개수는 runtime 활성화 여부로 결정한다. Launch Template이 참조하는 instance profile 출력은 부팅 권한 정책 생성에 의존하도록 한다. 이미 배포한 환경의 IAM role/instance profile 주소와 #341 이미지 정책은 그대로 둔다.
- 게시 주체나 CI 역할 변경, MSK IAM 클라이언트·토픽 준비, OpenSearch 접속, 실계정 호출은 이번 작업에서 제외한다.

## T. 구현 전 실패 테스트와 완료 조건

1. 모의 Terraform으로 기존 정책의 잘못된 ECR·Secret ARN을 재현한다. 활성화 시 실제 저장소 ARN과 두 필수 Secret만, Redis가 켜진 경우 세 번째 ARN만 허용하는지 정책 JSON을 확인한다.
2. 비활성화 시 부팅 Secret 정책이 없고 runtime 입력 없이 ECR 준비가 가능한지, 활성화 시 아직 모르는 ARN들로도 전체 Plan이 가능한지 확인한다. 기존 첫 배포·상품 이미지 회귀 테스트를 유지한다.
3. 렌더링한 부팅 스크립트와 AWS CLI·Docker 대역으로 Secret에 `username`, `password`만 있을 때 올바른 JDBC 주소와 registry 로그인·digest pull을 확인한다. 자격 증명이 비정상이면 Docker 실행이 없고, 로그가 값·토큰을 노출하지 않는지 확인한다.
4. 실제 IAM 권한, EC2 부팅, readiness와 삭제는 #91 승인 후 별도로 확인한다. 모의 테스트를 실계정 증적으로 사용하지 않는다.
