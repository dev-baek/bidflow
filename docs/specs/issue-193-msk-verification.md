# [Issue #193] MSK 검증 모듈 사양

- 상태: 제안됨
- 관련 Issue: [#193 MSK 검증 모듈 S/D/B/I/T 사양](https://github.com/dev-baek/bidflow/issues/193)
- 상위 Issue: [#89 관리형 데이터 서비스 검증 모듈](https://github.com/dev-baek/bidflow/issues/89)
- 후속 연결 사양: [#88 Spring Boot IAM 인증, 토픽 및 배포 순서](issue-088-msk-runtime.md)

## 목적과 제외 범위

Kafka의 Partition 순서, consumer group, 재시도·DLT 흐름을 AWS 관리형 Broker에서도 짧게 검증한다. 상시 운영 cluster, public broker, ZooKeeper 관리, 비용 최적화 주장은 제외한다.

## S. 화면

해당 없음. Broker endpoint·cluster ARN·bootstrap string은 Browser로 전달하지 않는다.

## D. 데이터와 보안

| 항목 | 결정 |
|---|---|
| 위치 | private data subnet의 MSK Serverless |
| 인증 | IAM SASL, long-lived password 없음 |
| 암호화 | in-transit TLS, AWS 관리형 at-rest encryption |
| Topic | `bid-command`, `bid-event`, `listing-event`; 각 3 partition 계약은 #52를 따른다 |
| 원본성 | PostgreSQL Outbox가 발행 근거이며 Kafka는 at-least-once 전달 경계 |
| 삭제 | 검증 종료 시 cluster 삭제; 장기 Event 보존 금지 |

## B. 런타임 동작

1. EC2 application role만 MSK IAM `Connect`, Topic Read/Write, Group 관리 권한을 가진다.
2. `auctionId`를 Key로 쓰는 Event는 같은 Partition의 순서만 보장한다.
3. Consumer 실패는 offset commit을 하지 않고 재시도·DLT 계약(#16)을 따른다.
4. Kafka 중단은 원장 Transaction을 직접 변경하지 않으며 Outbox 재발행으로 복구한다.

## I. Terraform 정책

- `enable_managed_kafka=false`가 기본이다.
- true는 Budget alarm·TTL·삭제 담당자 확인 뒤 승인된 verification Plan에서만 허용한다.
- MSK Serverless를 사용해 broker instance 수·storage를 별도 조정하지 않는다.
- application SG와 IAM role 외의 접근, public endpoint, plaintext client를 만들지 않는다.

## T. 검증

| 조건 | 기대 결과 |
|---|---|
| 기본 false | MSK cluster와 비용 리소스가 Plan에 없음 |
| enabled true | private VPC connection과 IAM client authentication만 생성 |
| 권한 없는 주체 | topic read/write·group commit 거절 |
| 같은 auction key | 같은 partition 순서 계약 유지 |
| destroy | cluster·VPC connection 잔여 없음 |

## 완료 조건

- [x] S/D/B/I/T·비용·삭제·보안 경계를 기록했다.
- [ ] 별도 구현 이슈에서 Terraform 모듈과 계약 테스트를 추가한다.
