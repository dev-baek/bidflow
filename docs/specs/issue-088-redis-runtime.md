# [Issue #88] ElastiCache Redis 부팅·TLS 연결 계약

- 상태: 제안. AWS 접속·비용·리소스 변경을 승인하지 않는다.
- 작업 이슈: [#88 배포 구성](https://github.com/dev-baek/bidflow/issues/88). 기존 [#89](https://github.com/dev-baek/bidflow/issues/89) 모듈은 재사용한다. 실제 연결·입찰·정리는 [#91](https://github.com/dev-baek/bidflow/issues/91)에서 검증한다.
- 선행: [ElastiCache 검증 모듈](issue-189-redis-verification.md), [EC2 부팅 권한](issue-088-runtime-bootstrap-access.md), [첫 배포 순서](issue-088-first-deployment.md).

## 문제

EC2 부팅은 ElastiCache 주소와 Secret ARN을 받지만, ARN은 Secret 리소스가 생성됐다는 뜻일 뿐 인증값을 저장하는 Secret version까지 준비됐다는 뜻은 아니다. 부팅 스크립트도 현재 `jq -r`로 값만 읽으므로 키가 없으면 문자열 `null`을 비밀번호로 넘길 수 있다. 또한 Runtime Secret의 Redis URL이 주입된 호스트·포트·비밀번호보다 우선할 수 있다. [Spring Boot 3.5의 Redis 연결 속성](https://docs.spring.io/spring-boot/3.5/appendix/application-properties/index.html#application-properties.data.spring.data.redis.url).

## S. 사용자와 운영자 흐름

- 화면·API는 바꾸지 않는다. Redis는 활성 경매의 입찰 상태와 실시간 화면 갱신에 사용한다. 원장은 여전히 PostgreSQL이다.
- 승인된 배포에서만 Redis를 켠다. #91에서는 EC2 기동 뒤 단순 포트 확인에서 끝내지 않고 입찰 처리, 브라우저 실시간 결과, PostgreSQL 원장 일치를 확인한다.

## D. 인증값의 소유권

| 값 | 출처와 처리 |
|---|---|
| 호스트·포트 | Terraform이 실제 private ElastiCache primary endpoint를 전달한다. 연결 포트는 기존 6379다. |
| AUTH 토큰 | 모듈이 생성하는 32자리 영숫자만 허용한다. 동일한 토큰을 ElastiCache와 Secret version에 사용하고 EC2 부팅 역할은 정확한 ARN 하나로 읽는다. |
| 값의 보관 | 앱 입력에는 부팅 시 만들어지는 root 전용 env-file만 사용한다. tfvars·User Data·Terraform output·로그에는 토큰을 넣지 않는다. 기존 토큰은 Terraform이 관리하므로 Plan/state 자체는 계속 민감 자료로 취급한다. |

현재의 노드 기반 Redis와 TLS + AUTH를 유지한다. Serverless 전환, RBAC, 인증값 회전이나 신규 권한은 이 작업에 넣지 않는다. [ElastiCache AUTH와 TLS 요구 사항](https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/auth.html).

## B. 부팅 계약

- Redis가 켜진 EC2는 기존 Spring Boot/Lettuce 연결 설정에 private host·port·TLS·검증한 토큰을 전달한다. 별도 Redis 클라이언트나 의존성을 추가하지 않고 TLS 인증서 검증을 완화하지 않는다.
- Secret이 누락됐거나 JSON이 잘못됐거나 토큰이 규격과 다르면 Docker 시작 전에 중단한다. 오류는 고정 설명만 남기고 원문·토큰을 기록하지 않는다. 로컬 Redis로 대체하지 않는다.
- Redis만 켠 경우에도 기존 Runtime Secret 검사기를 실행한다. URL, host·port·password·TLS, cluster/sentinel 대체 설정과 우회 가능한 Spring 설정을 차단한다. Redis를 끈 구성과 로컬 Compose의 기존 연결 계약은 유지한다.

## I. Terraform 배포와 경계

- Redis Secret ARN 출력은 Secret version의 준비에 명시적으로 의존하도록 한다. EC2는 기존 RDS·ECR 부팅 정책의 정확한 Redis Secret 권한과 해당 출력을 함께 참조한다. 앱에 Secret 생성·변경이나 Redis 관리 권한을 추가하지 않는다. [Terraform 출력 의존성](https://developer.hashicorp.com/terraform/language/block/output#depends_on).
- 기존 비공개 subnet·application SG, 전송 암호화, 스냅샷 미보존 및 기본 비활성화를 유지한다. Redis 토큰은 호스트의 AWS CLI에서 읽으므로 Redis만 켤 때 컨테이너용 IMDS hop limit을 확대하지 않는다.

## T. 구현과 완료 기준

1. 실패 테스트부터 작성한다. Terraform 모의 테스트에서 Redis 비활성 상태, EC2 보류 상태의 준비, Redis와 런타임이 모두 켜진 초기 Plan, Secret version 의존과 정확한 ARN을 확인한다.
2. 실제 부팅 템플릿을 AWS CLI·Docker 대역으로 실행해 정상 TLS 설정, 비정상 Secret의 시작 중단, Runtime Secret URL/cluster/sentinel 충돌 차단과 민감 값 비노출을 확인한다. Spring Boot 설정 대역에서 AWS 형식과 기존 로컬 형식을 구분해 확인한다.
3. #91에서만 승인된 환경의 TLS/AUTH와 입찰·실시간 알림·원장을 확인하고 Redis 클러스터, Secret 및 비승인 스냅샷의 잔존 여부를 기록한다. 모의 결과를 실제 배포나 Redis 성능 증적으로 삼지 않는다.
