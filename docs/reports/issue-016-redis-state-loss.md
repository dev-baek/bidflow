# [Issue #16] 단일 경매 Redis 상태 유실·복구 실측

- 실행: 2026-11-19, 로컬 Docker·Java 21·Spring Boot `local`, 실제 서버 시계
- 기준 commit: `a8ccaade3592ac658cf384640b353c66164c7934` (#256 병합)
- [수집 JSON](evidence/issue-016-redis-state-loss.json) · [복구 사양](../specs/issue-016-failure-recovery.md) · [기존 복구 구현](issue-086-redis-auction-recovery.md)

## 무엇을 검증했나

Redis 프로세스를 잠시 중단하는 실험과 달리, **새 시험 경매의 활성 상태·자동입찰 최대가·처리 캐시를 실제로 유실**시켰다. 전체 Redis flush나 기존 개발 경매 삭제 없이, 새 UUID로 삽입한 경매와 소유 판매자를 PostgreSQL에서 확인한 뒤 정확히 그 경매의 키 세 개만 제거했다.

Fixture는 PostgreSQL에 새 상품·경매를 삽입해 생성했다. 시작가는 10,000원, 시작은 서버 시각 1분 전, 마감은 30분 후인 활성 경매다. 상품 등록·업로드 E2E를 검증하는 실험은 아니다. 입찰은 모두 실제 HTTP → Outbox → Kafka → Redis Lua → PostgreSQL 경로로 처리했다.

| 단계 | 관측 |
|---|---|
| 유실 전 | A 최대가 30,000원, B 최대가 20,000원 승인. 현재가 21,000원·승자 A·version 3. PostgreSQL에 두 최대가와 원장 2건, Redis에도 동일 최대가 보존 |
| 키 제거 | `auction:84cc0fbf-aad7-4173-8666-c092f1f09be5:{state,auto,processed}` 세 키를 명시적으로 제거. 존재 수 0, PostgreSQL Snapshot은 변경 없음 |
| 다음 요청 | C의 최대가 25,000원을 새 키로 제출. HTTP 202 뒤 승인까지 대기 |
| 복구 후 | PostgreSQL·Redis·공개 상세의 현재가 26,000원, version 4. 승자 A와 최대가 30,000원 유지. Redis ZSET에 A 30,000 / B 20,000 / C 25,000 복원·반영 |
| TTL·원장 | 세 키 TTL 약 88,192초(마감 +24시간 정책에 부합). 원장 3건, 요청별 각각 1건. `bid-command.DLT` 모든 partition 로그 끝은 전후 동일 |
| HTTP 재시도 | 유실 전 A의 요청을 같은 키·금액으로 다시 보내면 기존 requestId 반환. 현재가·승자·version·원장 수 모두 복구 직후와 동일 |

복구 시 최고가 정보까지 PostgreSQL에서 읽기 때문에 C의 25,000원으로 기존 30,000원 최고 입찰자를 바꾸지 않았다. 재구성된 상태에서 C 명령을 처리한 결과를 원장·Redis·공개 API로 각각 대조했다.

## 재현 기준

1. 기존 [로컬 실행](../../README.md#로컬-실행)으로 PostgreSQL·Kafka·Redis와 API를 준비한다. 다른 부하나 테스트 Clock 변경과 동시에 실행하지 않는다.
2. 새 UUID·고유 판매자의 시험 상품과 활성 경매를 만든다. 두 자동입찰을 순서대로 제출하고 DB 정산 완료, Redis Hash/ZSET, TTL과 DLT 위치를 기록한다.
3. DB의 경매·상품 소유자가 새 Fixture 판매자인지 다시 확인한 뒤에만 해당 UUID의 세 키를 정확히 지정해 제거한다. 패턴 기반 삭제나 전체 flush는 금지한다. 제거 직후 키 0개와 DB 불변을 확인한다.
4. 세 번째 입찰을 HTTP로 제출하고 승인 여부와 DB·Redis·공개 현재가, 최고가, version을 비교한다. 앞선 두 사용자의 최대가도 Redis에 복원됐는지 확인한다.
5. 유실 전 요청의 HTTP 재시도와 요청별 원장 수, DLT 증가 여부를 확인한다. 기존 데이터는 변경하지 않고 증적을 보존한다.

## 한계와 삭제 대상

- 제거한 세 키는 이번 합성 경매 전용이며 복구 후 다시 존재한다. PostgreSQL 원본은 삭제하지 않아 현재가·최고가·승자·자동입찰 목록을 재구성할 수 있었다. 기존 Redis 데이터와 볼륨은 초기화하지 않았다.
- **과거 `processed` 캐시 2건은 복구되지 않았다.** 복구 후 캐시에는 새 C 요청의 처리 결과 1건만 있다. A 요청의 HTTP 재시도 안전성은 PostgreSQL 멱등 접수 기록에 근거한다. 이번 실험을 과거 Kafka 명령 재발행·캐시 전체 재생 성공으로 해석하지 않는다.
- 단일 로컬 경매의 전체 키 유실을 확인했다. state 키는 남고 auto 키만 사라지는 부분 유실, 다중 Worker 복구 경합, Redis 전체 볼륨 유실은 검증하지 않았다. 종료된 경매를 되살리지 않는 경계는 기존 단위/통합 테스트의 증적이다.
- API·로컬 인프라는 실행 상태이고 새 합성 데이터는 남겼다. AWS 계정·리소스는 사용하지 않았다.

## #16 로컬 MVP 완료 증적

| 완료 조건 | 증적 |
|---|---|
| Consumer 중단 후 새 명령 이어받기 | [정산 Listener 단독 중단 실측](issue-096-settlement-consumer-recovery.md) |
| Redis 유실 뒤 단일 경매 복구 | 이 보고서와 [Snapshot 복구 구현·테스트](issue-086-redis-auction-recovery.md) |
| 실패 원인과 수동 재처리 결과 기록 | [검색 장애 격리](issue-096-opensearch-recovery.md) → [동일 eventId 재발행·검색 복구·중복 확인](issue-016-listing-replay-recovery.md) |
| Consumer 중복 방지·재시도·DLT | [Consumer 멱등 보고서](issue-085-consumer-idempotency.md), CLI·검증 테스트 |

완료 범위는 승인된 사양의 **로컬 단일 경매 복구와 단일 검색 이벤트 재처리**다. 모든 DLT 종류를 자동 복구하거나 AWS 장애 내성을 입증했다는 뜻이 아니다.
