# [Issue #26] Redis 사용 범위와 복구 전략 ADR

- 상태: 승인됨
- 작성일: 2026-11-12
- 관련 Issue: [#26 Redis 사용 범위와 복구 전략 ADR 작성](https://github.com/dev-baek/bidflow/issues/26)
- 상위 사양: [EC2 이벤트 기반 아키텍처와 ADR](./issue-002-architecture-adr.md)

## 1. 결정

Redis는 활성 경매의 짧은 수명 상태를 원자적으로 계산하고, 같은 요청의 재시도 결과를 유지하며, 실시간 화면 갱신을 전달하는 데만 사용한다. 거래의 최종 사실과 복구 기준은 PostgreSQL에 둔다.

```text
PostgreSQL = 입찰 원장·자동입찰 설정·확정된 경매 상태
Redis      = 활성 경매 계산 상태·짧은 TTL·실시간 Pub/Sub
Kafka      = 순서가 필요한 명령·재처리 가능한 이벤트
```

이 결정은 로컬 Docker Redis에서 먼저 검증한다. AWS 이전은 로컬 통합·장애 복구 기준을 통과한 뒤 Redis 접속 Adapter를 ElastiCache로 교체하는 별도 작업이다.

## 2. 문제와 선택 이유

자동입찰은 한 요청에서 현재가, 최고 입찰자, 각 사용자의 최대 금액, 같은 요청의 재시도 결과를 함께 변경한다. 여러 명령으로 나누면 중간 상태가 노출되거나 경쟁 요청이 서로 덮어쓸 수 있다.

Redis Lua Script는 한 경매의 여러 Key 변경을 원자적으로 실행한다. Kafka가 같은 `auctionId`의 명령을 같은 Partition 순서로 전달하고, Lua Script가 해당 명령의 내부 상태 변경을 하나의 단위로 만든다. 이 조합은 “순서 있는 입력”과 “부분 반영 없는 계산”을 분리한다.

Redis를 최종 원장으로 선택하지 않는 이유는 다음과 같다.

- Redis 유실·초기화 후에도 입찰 이력과 낙찰 판단을 복원해야 한다.
- Pub/Sub은 구독 중이 아닌 소비자에게 메시지를 보관하지 않는다.
- 거래 감사와 멱등성의 근거는 관계형 Transaction으로 남아야 한다.

## 3. 허용 범위

| 용도 | Redis 데이터 | 영속 기준 | 복구 방법 |
|---|---|---|---|
| 자동입찰 계산 | 최고 입찰자, 현재가, 최대 금액, 요청 결과 | PostgreSQL 입찰 원장·자동입찰 설정 | 활성 경매 Snapshot 재구축 |
| 멱등 재시도 | `bidRequestId`별 계산 결과 | PostgreSQL 요청·입찰 기록 | 이미 확정된 결과 재조회 또는 재계산 |
| 요청 제한 | 사용자·IP 단위 짧은 TTL Counter | 없음 | TTL 만료를 허용 |
| 실시간 전파 | 입찰 결과 Pub/Sub | PostgreSQL 확정 상태 | Browser REST 재조회 |

다음 데이터는 Redis에만 두지 않는다.

- 승인·거절된 입찰의 감사 기록
- 자동입찰 최대 금액의 유일한 원본
- 경매 종료·낙찰·유찰의 최종 상태
- Kafka Consumer의 처리 완료 근거

## 4. Key와 Lua 계약

실제 Key 접두사는 환경별로 분리하고, 모든 활성 경매 Key에는 `auctionId`를 포함한다.

```text
auction:{auctionId}:state          Hash: currentPrice, leaderId, version
auction:{auctionId}:max-bids       Sorted Set: member=userId, score=maxAmount
auction:{auctionId}:request:{id}   Hash/String: 계산 결과, TTL
rate-limit:{subject}:{window}      Counter, TTL
```

Lua Script 입력은 `auctionId`, `bidRequestId`, 사용자 ID, 직접 입찰가 또는 자동입찰 최대 금액, 최소 입찰 단위, 기준 시각이다. Script는 시스템 시각과 UUID를 내부에서 생성하지 않는다.

반환값은 다음 중 하나로 고정한다.

```text
ACCEPTED          승인된 현재가·최고 입찰자·상태 버전
REJECTED          거절 코드와 현재 상태 버전
REPLAYED          같은 bidRequestId로 고정된 최초 결과
NOT_ACTIVE        활성 상태가 없어 PostgreSQL 복구가 필요한 신호
```

Script는 `bidRequestId` 결과를 상태 변경과 같은 원자 작업에서 저장한다. 동일 요청의 재시도는 가격을 다시 올리지 않고 `REPLAYED`와 최초 결과를 반환한다.

## 5. 처리와 장애 경계

```text
Kafka bid-command (auctionId Key)
→ Bid Worker
→ Redis Lua 계산
→ PostgreSQL Transaction: 입찰 원장·경매 현재가·Outbox
→ Redis Pub/Sub
→ WebSocket
```

Redis 반영 뒤 PostgreSQL Transaction이 실패하면 Kafka Message를 Commit하지 않는다. 다시 소비한 같은 `bidRequestId`는 Redis에 남아 있는 최초 계산 결과를 받아 PostgreSQL 저장을 재시도한다.

Redis가 유실된 경우 `NOT_ACTIVE`를 반환하거나 Key가 사라진다. Worker는 임의의 기본값으로 계산하지 않고 복구 절차를 실행한다. 복구가 끝나기 전 해당 경매 명령은 재시도 가능한 실패로 남겨 Kafka Commit을 하지 않는다.

Pub/Sub 전송 실패나 Browser 연결 끊김은 거래 실패가 아니다. Browser는 재연결 후 REST로 PostgreSQL의 확정 상태를 조회한다.

## 6. 복구 절차

1. Redis 연결·Script 오류 또는 활성 상태 Key 부재를 감지한다.
2. 해당 `auctionId`의 처리를 멈추고 Kafka Message를 Commit하지 않는다.
3. PostgreSQL에서 진행 중 경매, 마지막 확정 현재가, 최고 입찰자, 유효 자동입찰 설정을 읽는다.
4. Redis 상태 Hash·Sorted Set·요청 결과를 같은 `auctionId` 범위로 재구축한다.
5. 재구축 Snapshot의 버전과 원장을 검증한다.
6. 실패했던 Kafka Message를 다시 소비한다.

복구는 전체 Redis를 삭제하거나 모든 경매를 일괄 재구축하지 않는다. 먼저 영향받은 `auctionId` 범위로 제한하고, 전면 유실일 때만 PostgreSQL의 진행 중 경매 목록으로 배치 복구한다.

## 7. 테스트·관측 기준

| 시나리오 | 기대 결과 |
|---|---|
| 같은 `bidRequestId`를 두 번 처리 | 현재가가 한 번만 변경되고 최초 결과 반환 |
| 동시에 두 자동입찰 명령 처리 | Hash·Sorted Set·요청 결과가 부분 반영되지 않음 |
| PostgreSQL 저장 실패 후 재소비 | Kafka Commit 없이 같은 Redis 결과로 저장 재시도 |
| Redis Key 삭제 후 명령 수신 | 임의 계산 금지, PostgreSQL에서 해당 경매 복구 |
| Pub/Sub 메시지 유실 | Browser REST 재조회로 확정 상태 보정 |
| Redis 재시작 후 활성 경매 | 진행 중 경매의 상태를 재구축 가능 |

로컬 Docker Redis를 이용한 Adapter 통합 테스트와, Redis 상태 삭제 후 복구하는 장애 실험을 구현 증적으로 남긴다. Redis Hit Rate나 메모리 사용량은 기능 구현 후 부하 실험에서 측정한다.

## 8. 대안과 전환 조건

### PostgreSQL만 사용

자동입찰 계산도 Row Lock과 Transaction으로 만들 수 있다. 다만 활성 경매의 빠른 경쟁 계산·요청 제한·다중 인스턴스 실시간 전파를 한 저장소에 집중시키므로 이번 포트폴리오의 Redis 원자 연산과 복구 경험을 보여주지 못한다.

### Redis를 최종 원장으로 사용

낮은 지연시간은 얻지만 입찰 감사·장애 복구·낙찰 판단의 신뢰 근거가 약해진다. 제외한다.

### AWS ElastiCache로 즉시 시작

로컬 Docker 검증 전에는 비용만 발생하고 실패 원인 분리가 어려워진다. 로컬 테스트, 복구 실험, 부하 기준을 통과한 뒤 접속 Adapter와 운영 설정을 교체한다.

## 9. 완료 조건

- [x] Redis의 허용·금지 사용 범위가 명확하다.
- [x] PostgreSQL을 최종 원장으로 두는 이유가 기록됐다.
- [x] Lua 입력·반환·멱등 재시도 계약이 정의됐다.
- [x] Redis 유실·Pub/Sub 유실의 복구 주체와 절차가 정의됐다.
- [x] 로컬 우선 검증과 AWS 이전 조건이 기록됐다.
