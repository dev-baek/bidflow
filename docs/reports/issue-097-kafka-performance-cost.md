# [Issue #97] Kafka 선택과 성능·비용 검증

- 관련: [#97 Kafka 검증](https://github.com/dev-baek/bidflow/issues/97) · [#19 부하·장애 Epic](https://github.com/dev-baek/bidflow/issues/19) · [실험 사양](../specs/issue-019-load-failure-test.md) · [Kafka/SQS ADR](../specs/issue-029-kafka-sqs-decision-adr.md)
- 범위: MacBook 로컬 실측의 해석, SQS FIFO 설계 비교, 도쿄 리전 공개 단가 예시. AWS 리소스를 프로비저닝하거나 SQS 부하를 측정하지 않았다.

## 왜 Kafka인가

**경매별 순서만 필요하다면 SQS FIFO도 충분하다.** BidFlow는 입찰 명령을 경매별로 처리하면서, 입찰 이벤트는 검색·실시간 전파·경매 종료 후처리가 서로 다른 속도로 읽어야 한다. 여기에 보존 구간 내 이벤트 재처리까지 고려하면 Kafka의 파티션·그룹·오프셋 모델이 이 요구를 한 로그에서 표현한다. Kafka가 SQS보다 빠르다는 실측 근거로 선택한 것은 아니다.

| 실제 토픽 | 메시지 키 | 독립 소비 그룹 |
|---|---|---|
| `bid-command` | `auctionId` | `bid-settlement` |
| `bid-event` | `auctionId` | `search-projection`, `realtime-projection`, `auction-finalization` — 각 그룹은 필요한 이벤트만 처리 |
| `listing-event` | `productId` | `search-projection` |

같은 토픽에서 파티션 배정이 유지되면 같은 경매 키의 레코드가 같은 파티션에 기록된다. 처리 순서의 기준은 **파티션 로그에 기록된 순서**이며, HTTP 도착 순서나 서로 다른 토픽 간 전역 순서가 아니다. 그룹은 독립적으로 오프셋을 커밋하므로 검색 그룹이 지연돼도 정산 그룹의 오프셋이 같이 멈추지 않는다. [Apache Kafka: 순서·보존·독립 소비](https://kafka.apache.org/41/getting-started/introduction/)

Kafka는 DB 원장에 대한 정확히 한 번 반영을 보장하지 않는다. BidFlow는 PostgreSQL Outbox로 상태 변경과 발행할 이벤트를 함께 기록하고, 같은 `Idempotency-Key`의 입찰 재시도는 같은 요청으로, 같은 `eventId` 재전달은 `(consumer_name, event_id)` 처리 기록으로 수렴시킨다. Redis는 입찰 상태의 원자적 계산에 쓰고, 확정 원장의 기준은 PostgreSQL이다. 복구 시 기존 그룹 오프셋을 되감는다고 이미 성공한 효과가 자동으로 다시 적용되지는 않는다. Projection 재구축에는 새 처리 기록 범위나 별도 재색인 절차가 필요하다. [Consumer 멱등성 구현·검증](issue-085-consumer-idempotency.md)

## 로컬에서 확인한 것

| 시나리오 / 증적 | 관측 | 해석과 한계 |
|---|---|---|
| [단일 경매 집중 입찰](issue-019-focused-load-baseline.md) | HTTP `202` 20건, 접수 P95 **78.14ms**. 요청 기록 → 처리 시작 P95 **886.47ms**. 승인 1건·하한 미달 19건, 요청별 원장 1건. | 접수와 판정은 다른 지표다. Lag는 시작 전·종료 후 모두 0이었으나 중간 피크는 미측정. |
| [6개 경매 분산 입찰](issue-019-distributed-load-baseline.md) | 20 VU 유지 2분, HTTP `202` 2,535건, 접수 P95 **41.88ms**, 요청 기록 → 처리 시작 P95 **1,338.53ms**. 승인 6건·거절 2,529건, 미처리·중복 원장 0건. Kafka Lag 최대 관측 10건, 종료 약 2.04초 뒤 첫 조회에서 0. | 단일/분산 실험의 부하 패턴이 달라 P95 차이로 우열을 판단할 수 없다. 세 파티션 유입은 422 / 1,689 / 424건으로 한 파티션에 약 67%가 몰렸다. |
| [정산 Consumer만 중단](issue-096-settlement-consumer-recovery.md) | API·검색은 유지. 대기한 입찰 3건은 `202`, 중단 중 해당 원장 0건. Lag 0 → 3 → 0, 재시작 응답 후 약 5.32초에 첫 0 관측. 세 입찰 모두 승인, 최종가 15,000원, 요청별 원장 1건. | 커밋되지 않은 새 명령을 재시작 후 이어받았다. 이미 처리된 과거 레코드를 되감는 실험은 아니다. |
| [Redis 중단](issue-096-redis-recovery.md) | 새 입찰 `202`, 공개 현재가 12,000원 유지. Lag 0 → 1 → 0, 복구 후 DB·Redis·원장 모두 13,000원, 재요청으로 중복 원장 없음. | 짧은 단일 중단에서 후속 처리와 정합성을 확인했다. 장기 장애나 Redis 데이터 유실 검증은 아니다. |
| [OpenSearch 중단](issue-096-opensearch-recovery.md) | 검색 `503`, 상품 등록 `201`·입찰 접수 `202` 및 정산 유지. 등록 이벤트 1건이 DLT로 격리됐고, 검색 그룹 Lag 0에서도 상품은 검색되지 않았다. PostgreSQL 기반 재색인 후 복구. | **Lag 0은 업무 성공을 뜻하지 않는다.** DLT 증가, 색인 성공 기록, API 결과를 함께 봐야 한다. DLT 재발행·자동 복구를 측정한 것은 아니다. |

위 기준선의 HTTP P95는 접수 응답, 서버 P95는 처리 시작까지다. 최종 DB 커밋이나 브라우저 WebSocket 전달의 P95는 이 자료로 알 수 없다. Lag는 표본으로 수집했으므로 실제 피크나 정확한 복구 시간을 알 수 없다. 한 Mac의 단일 브로커 결과를 AWS 지연, 최대 처리량, 브로커 장애 내성으로 일반화하지 않는다.

후속 [Outbox 간격 A-B-A 실측](issue-019-outbox-delay-aba.md)은 별도 로컬 순차 브라우저 실험이다. 기본 화면 P95가 1,000ms 조건에서 약 2.93초, 100ms 후보에서 431ms로 줄고 복원 조건에서 다시 약 2.94초가 됐으며, 유휴 조회 빈도·DB CPU 증가는 함께 보고했다. 이는 Kafka 자체의 속도나 SQS 대비 우위가 아니라 Outbox 조회 정책의 지연/빈 조회 절충 근거다. 기존 집중/분산 부하 수치와 합치지 않으며 기본 간격도 아직 바꾸지 않았다.

운영에서 먼저 볼 것은 **파티션별 Lag와 이벤트 대기 시간**이다. 한 경매가 한 파티션에 묶이는 한 Consumer 수만 늘려도 해당 경매는 병렬 처리되지 않는다. 관측한 파티션 쏠림은 점검 후보이며, DB 잠금·Redis 왕복·Outbox 발행 지연을 별도로 재지 않았으므로 원인을 Kafka로 단정할 수 없다. 그룹별 Lag 외에도 DLT 신규 유입, 오래 대기 중인 입찰, PostgreSQL과 검색 응답 간 불일치를 확인해야 한다.

## SQS FIFO를 고른다면

| 요구 | Kafka | SQS FIFO 대안 |
|---|---|---|
| 경매별 입찰 순서 | `auctionId`를 메시지 키로 사용 | 같은 값을 `MessageGroupId`로 사용. [AWS FIFO 메시지 그룹](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/using-messagegroupid-property.html) |
| 검색·실시간·종료 후처리의 독립 소비 | 이벤트 토픽을 여러 그룹이 각각 읽음 | 입찰 명령은 FIFO 큐 1개로 충분. 도메인 이벤트는 SNS FIFO와 기능별 SQS FIFO 큐로 분배. 같은 큐의 여러 Worker는 메시지를 나눠 처리하며 각자 사본을 받지 않음. |
| 과거 이벤트 재처리 | 보존 중인 레코드를 새 그룹 또는 오프셋 조정으로 다시 읽음 | 처리 후 삭제된 메시지를 SQS 큐에서 오프셋으로 다시 읽을 수 없음. 대신 SNS FIFO 아카이브를 사전 설정해 구독별 재생을 설계할 수 있음. [AWS SNS FIFO 보관·재생](https://docs.aws.amazon.com/sns/latest/dg/fifo-message-archiving-replay.html) |
| 실패·운영 부담 | 파티션·보존·Lag·오프셋·DLT를 관리 | 브로커 관리가 없지만 큐별 가시성 타임아웃·DLQ·폴링을 관리. 팬아웃을 쓰면 구독·보관·재생도 추가. 두 대안 모두 멱등 처리가 필요. |

입찰 Worker만 남고 독립 소비·과거 재처리가 필요 없어진다면 FIFO 큐를 우선 재검토한다. 여러 소비자와 재생이 필요한 현재 구조에서도 SNS+SQS는 유효한 대안이지만, 처리량·지연·복구 동작을 비교 실측한 적은 없다.

## AWS 요금 예시 — 실측 청구액 아님

도쿄(`ap-northeast-1`) USD 공개 단가, 2026-11-17 조회. 세금·환율·무료 구간·크레딧을 반영하지 않았고 메시징 외 비용을 제외했다. 로컬 설정의 일반/DLT 토픽 6개 × 3 파티션은 MSK 예시의 입력일 뿐이며, MSK 브로커 성능이나 복제 구성의 동등함을 뜻하지 않는다. [로컬 토픽 설정](../../scripts/provision-kafka-topics.sh)

| 예시 범위 | 가정과 계산 | 추정 소계 |
|---|---|---:|
| MSK Serverless: 클러스터 1개 | 2시간, 과금 대상 18개 파티션, 입력 0.10 GB·출력 0.20 GB, 그 시간 동안 평균 저장 0.10 GB. `2 × 0.9675 + 18 × 2 × 0.0019 + 0.10 × 0.129 + 0.20 × 0.0645 + 0.10 × (2 / 730) × 0.12`. 월 730시간은 저장분 환산 가정. | **약 $2.03** |
| SQS FIFO: 입찰 명령 큐만 | 작은 메시지 명령 10,000건을 배치 없이 각 1회 Send·Receive·Delete. 빈 폴링·중복·재시도 없음. `30,000 / 1,000,000 × 0.50`. | **$0.015** |

출처: [MSK 과금 방식](https://aws.amazon.com/msk/pricing/) · [MSK 도쿄 단가 JSON](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonMSK/current/ap-northeast-1/index.json) · [SQS 요청 과금 방식](https://aws.amazon.com/sqs/pricing/) · [SQS 도쿄 단가 JSON](https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AWSQueueService/current/ap-northeast-1/index.json). SQS는 빈 수신도 요청에 포함되고, 페이로드 크기에 따라 64 KiB 단위의 추가 요청으로 계산될 수 있다.

두 소계는 **같은 업무 범위 비교가 아니다**. 현재의 이벤트 소비 3개를 포함하는 FIFO 구성이라면 [SNS 게시·전송·아카이브·재생 비용](https://aws.amazon.com/sns/pricing/)과 기능별 큐의 요청량도 더해야 한다. MSK 예시에서 시간 과금만 $2.0034로 사용량 과금보다 비중이 크다. 실제 검증 견적에는 생성부터 삭제까지 과금 시간, 데이터 전송·네트워크, EC2·DB·Redis·검색 등 나머지 리소스를 합산해야 한다. **10만 원 한도 내 전체 검증 비용이나 AWS 청구액을 확인한 것은 아니다.** 실제 AWS 검증과 리소스 정리는 별도 승인 후 [AWS Smoke Test·Destroy 검증 #91](https://github.com/dev-baek/bidflow/issues/91)에서 다룬다.

## 면접에서 설명한다면

> 같은 경매 안의 순서만 필요했다면 SQS FIFO로도 충분했습니다. BidFlow에서는 정산 명령은 경매별로 처리하되, 입찰 이벤트는 검색·실시간 전파·종료 후처리에서 각자 읽고 필요할 때 재처리할 수 있어야 해서 Kafka를 선택했습니다. 로컬에서는 정산 Consumer만 내렸을 때 입찰 3건이 대기했다가 중복 원장 없이 복구되는 것을 확인했습니다. 반대로 검색은 Lag가 0이어도 DLT에 빠진 이벤트 때문에 결과가 누락돼, Lag만으로 업무 성공을 판단할 수 없다는 것도 확인했습니다. 이 결과는 AWS 성능이나 SQS 대비 우위를 뜻하지 않습니다.
