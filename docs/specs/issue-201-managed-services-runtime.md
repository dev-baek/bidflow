# [Issue #201] 관리형 데이터 서비스 런타임 연결 사양

- 상태: 제안됨
- 관련 Issue: [#201 관리형 데이터 서비스 런타임 연결 사양](https://github.com/dev-baek/bidflow/issues/201)
- 상위 Issue: [#89 관리형 데이터 서비스 검증 모듈](https://github.com/dev-baek/bidflow/issues/89)

## 목적

선택적으로 생성되는 Redis, MSK, OpenSearch endpoint와 secret을 private EC2 runtime에만 전달한다. Browser, Terraform output, GitHub log에는 credential·broker endpoint를 노출하지 않는다.

## S. 화면

해당 없음. 관리형 서비스 연결값은 운영자·Browser 화면에 표시하지 않는다.

## D. 연결 데이터

| 서비스 | runtime 값 | 비밀값 |
|---|---|---|
| Redis | TLS endpoint, port | Secrets Manager `redis_auth_token` |
| MSK | IAM SASL bootstrap brokers | 없음, EC2 IAM role 사용 |
| OpenSearch | HTTPS VPC endpoint | 없음, EC2 IAM policy 사용 |

## B. 런타임 규칙

1. `enable_managed_*`가 false면 해당 endpoint는 전달하지 않고 기존 로컬 값도 AWS runtime에 가정하지 않는다.
2. enabled service의 endpoint와 Redis secret은 boot 시 instance role로만 읽어 root-owned env file에 조립한다.
3. Redis secret·RDS secret을 Docker command line, system log, Terraform output에 쓰지 않는다.
4. MSK IAM과 OpenSearch IAM 권한은 application role의 리소스 범위로 제한한다.

## I. 배포 순서

1. 승인된 Terraform Plan에서 선택 service와 runtime을 함께 생성한다.
2. service endpoint/secret ARN이 준비된 뒤 Launch Template version을 갱신한다.
3. ALB readiness가 통과한 instance만 traffic을 받는다.
4. 검증 뒤 runtime → managed service 순으로 destroy한다.

## T. 검증

| 조건 | 기대 결과 |
|---|---|
| 모두 false | runtime에 Redis/MSK/OpenSearch 연결값 없음 |
| Redis true | TLS endpoint와 auth token만 root-owned env file에 존재 |
| MSK true | IAM SASL bootstrap만 전달, password 없음 |
| OpenSearch true | HTTPS endpoint만 전달 |
| secret 값 | Terraform output·GitHub log·Browser에 없음 |

## 완료 조건

- [x] S/D/B/I/T 연결 경계와 optional service 조건을 기록했다.
- [ ] 별도 구현 이슈에서 User Data·IAM·Terraform output 연결을 추가한다.
