# [Issue #53] 로컬 Kafka 토픽과 파티션 정책 검증 보고서

- 작업 완료일: 2026-11-12
- Issue: [#53 로컬 Kafka 토픽과 파티션 정책 구성](https://github.com/dev-baek/bidflow/issues/53)
- 사양: [issue-008-event-contract.md](../specs/issue-008-event-contract.md)
- 브랜치: feature/issue-53-local-kafka-topics

## 1. 구현 결과

- Kafka 자동 Topic 생성을 비활성화했다.
- bid-command, bid-event, listing-event를 명시적 스크립트로 생성한다.
- 세 Topic 모두 Partition 3, Replication Factor 1, retention.ms=604800000(7일)을 사용한다.
- make local-up, make local-up-search 뒤에 Topic 정책을 적용한다.
- 이미 만든 Topic을 다시 적용해도 --if-not-exists로 안전하게 통과한다.

## 2. RED 증적

| 대상 | 확인한 실패 |
|---|---|
| Topic Provisioning Script | 스크립트 부재로 Shell Test 종료 코드 127 |
| 실제 Kafka 설정 검증 | 최초 --describe 출력의 PartitionCount: 3 공백 형식과 테스트 Fake 출력 형식 차이로 정책 검증 실패 |

실제 Broker 출력에 맞게 Partition·복제 수 비교에서 콜론 뒤 공백을 허용하도록 수정했다. 이 수정 후 Fake Docker Test와 실제 Docker Kafka 검증을 모두 통과했다.

## 3. GREEN 증적

~~~
sh tests/scripts/provision-kafka-topics.test.sh
make local-up
make local-topics
~~~

| Topic | Partition | Replication Factor | Retention |
|---|---:|---:|---:|
| bid-command | 3 | 1 | 7일 |
| bid-event | 3 | 1 | 7일 |
| listing-event | 3 | 1 | 7일 |

make local-topics를 다시 실행해도 기존 Topic 설정을 유지하며 성공했다.

## 4. 실제 순서 검증

bid-command에 같은 Key로 두 메시지를 발행했다.

~~~
auction-42:first
auction-42:second
~~~

Kafka Consumer 출력:

~~~
Partition:2|auction-42|first
Partition:2|auction-42|second
~~~

두 메시지가 같은 Partition에 발행 순서대로 기록됐다. 이 결과는 auctionId Key가 같은 경매의 명령 순서를 같은 Kafka Partition 안에서 보장한다는 사양을 확인한다. 전체 Topic의 전역 순서를 의미하지는 않는다.

## 5. 범위와 한계

- 로컬 단일 Broker는 Replication Factor 1이므로 Broker 장애 내결함성을 제공하지 않는다.
- Topic·Partition·보존 정책의 실제 운영 수치는 AWS 이전 전에 처리량·Consumer Lag·비용 측정으로 재검토한다.
- Producer Outbox, Consumer 멱등 처리, DLQ/격리 Topic은 후속 Backend·장애 복구 이슈에서 구현한다.

## 6. 완료 조건

- [x] 이벤트 계약 사양의 Topic 이름과 일치한다.
- [x] 자동 Topic 생성 없이 명시적으로 생성한다.
- [x] 정상·불일치 Partition 정책을 Shell Test로 검증한다.
- [x] 실제 Docker Kafka에서 Topic 설정을 검증한다.
- [x] 같은 auctionId Key의 Partition 순서를 검증한다.
