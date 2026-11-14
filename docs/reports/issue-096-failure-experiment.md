# [Issue #96] Consumer·Redis·OpenSearch 장애 실험 도구 보고서

- 작업 완료일: 2026-11-14
- Issue: [#96 Consumer·Redis·OpenSearch 장애 실험 수행](https://github.com/dev-baek/bidflow/issues/96)
- 사양: [issue-019-load-failure-test.md](../specs/issue-019-load-failure-test.md)
- 브랜치: `feature/issue-96-failure-experiments`

## 1. 구현 결과

- `make failure-redis-stop/start`, `make failure-opensearch-stop/start`은 `bidflow-local` Compose Project 안의 `redis`, `opensearch` service만 stop/start한다.
- Docker volume 제거, `FLUSHALL`, 외부 Compose Project 조작은 수행하지 않는다. `start`는 기존 volume을 유지하므로 재시작 뒤 복구 경로를 관찰할 수 있다.
- `make consumer-lag`은 `BIDFLOW_CONSUMER_GROUP`을 입력받아 Kafka의 consumer group Lag를 읽기 전용으로 조회한다.
- Spring Boot가 현재 단일 프로세스라 Consumer만 독립 중단하는 자동화는 제공하지 않는다. 사용자에게 PID·임의 명령 실행을 요구하거나 종료하지 않으며, Consumer 실험은 API/Worker 분리 배포 단위가 준비된 뒤 실행한다.

## 2. 실행 순서

~~~sh
make local-up-search

# 애플리케이션과 활성 경매 Fixture를 준비하고 부하/명령을 발행한다.
BIDFLOW_FAILURE_TARGET=redis BIDFLOW_FAILURE_ACTION=stop make failure-redis-stop
BIDFLOW_FAILURE_TARGET=redis BIDFLOW_FAILURE_ACTION=start make failure-redis-start

BIDFLOW_CONSUMER_GROUP=bid-settlement make consumer-lag

BIDFLOW_FAILURE_TARGET=opensearch BIDFLOW_FAILURE_ACTION=stop make failure-opensearch-stop
BIDFLOW_FAILURE_TARGET=opensearch BIDFLOW_FAILURE_ACTION=start make failure-opensearch-start
~~~

서비스 중단 전후에는 #94의 SQL 불변식, Kafka Lag, DLT Header, 검색 API 결과를 함께 수집한다.

## 3. 검증 증적

~~~sh
sh tests/scripts/inject-local-failure.test.sh
sh tests/scripts/check-kafka-consumer-lag.test.sh
~~~

- 잘못된 target/action 또는 Consumer group 누락은 exit 2로 중단한다.
- Fake Docker 검증으로 Redis stop과 OpenSearch start가 정확히 BidFlow Compose 파일·service에만 전달됨을 확인했다.
- Lag 조회가 Kafka service 내부의 `kafka-consumer-groups.sh --describe --group` 명령만 호출함을 확인했다.

## 4. 실제 장애 결과 상태

이 작업 시점에는 `bidflow-local` Compose service와 Spring Boot API가 실행 중이지 않아 실제 장애 주입 결과를 기록하지 않았다. 실행하지 않은 성능·복구 결과를 성공으로 주장하지 않는다. 활성 Fixture와 애플리케이션을 준비한 뒤 #102에 실행 시각, 환경, SQL 정합성, Lag 회복, DLT Header를 추가 기록한다.
