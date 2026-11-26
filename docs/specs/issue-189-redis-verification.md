# [Issue #189] ElastiCache Redis 검증 모듈 사양

- 상태: 제안됨
- 관련 Issue: [#189 ElastiCache Redis 검증 모듈 구성](https://github.com/dev-baek/bidflow/issues/189)
- 상위 Issue: [#89 관리형 데이터 서비스 검증 모듈](https://github.com/dev-baek/bidflow/issues/89)
- 후속 연결 사양: [#88 ElastiCache Redis 부팅·TLS 연결](issue-088-redis-runtime.md).

## 목적과 제외 범위

로컬 Docker Redis와 같은 역할의 임시 AWS 검증용 Redis를 private network에만 만든다. 이 모듈은 경매 원장이 아닌 복구 가능한 활성 경매 상태와 자동 입찰 처리만 지원한다.

- 상시 운영, public endpoint, 평문 Redis 연결은 범위에서 제외한다.
- Kafka와 OpenSearch는 별도 하위 이슈에서 구성한다.

## S. 화면

해당 없음. Redis endpoint와 credential은 Browser에 표시하거나 전달하지 않는다.

## D. 데이터와 보안

| 항목 | 결정 |
|---|---|
| 네트워크 | data subnet group, public access 없음 |
| 전송 | TLS 필수 |
| 인증 | auth token은 Secrets Manager에서만 읽고 tfvars에 넣지 않음 |
| 원본성 | PostgreSQL이 원장, Redis는 재생 가능한 파생 상태 |
| 삭제 | 검증 종료 시 Redis 삭제, snapshot 보존하지 않음 |

## B. 런타임 동작

1. EC2 application security group만 Redis 6379/TLS로 연결한다.
2. Redis 장애는 입찰 원장을 직접 변경하지 않는다.
3. 런타임은 Secret ARN을 통해 credential을 읽는다. secret 값은 Terraform output·GitHub log·User Data에 쓰지 않는다.
4. Redis 삭제 또는 장애 후에는 PostgreSQL snapshot으로 활성 경매 상태를 복구한다.

## I. Terraform 정책

- `enable_managed_redis=false`가 기본이며, false면 Redis resource와 endpoint secret을 만들지 않는다.
- true는 비용·삭제 시각을 검토한 verification Plan에서만 허용한다.
- single-node 검증 구성을 사용하며, production HA 또는 Multi-AZ를 주장하지 않는다.
- security group은 application SG ingress만 허용한다.

## T. 검증

| 조건 | 기대 결과 |
|---|---|
| 기본값 false | Terraform Plan에 Redis resource 없음 |
| enabled true | private subnet group, TLS, auth token, application SG만 존재 |
| public CIDR ingress | 계약 테스트 실패 |
| Redis 중단 | PostgreSQL 원장과 낙찰 결과는 변하지 않음; 복구 시나리오는 기존 #86 증적을 사용 |
| destroy | Redis와 관련 secret만 삭제되고 승인 없는 snapshot은 남지 않음 |

## 완료 조건

- [x] S/D/B/I/T 경계와 비용 승인 조건을 기록했다.
- [x] Redis를 원장이 아닌 복구 가능한 파생 상태로 명시했다.
- [ ] Terraform 모듈과 계약 테스트가 이 사양에 맞게 구현된다.
