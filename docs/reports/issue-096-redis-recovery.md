# [Issue #96] 로컬 Redis 중단·복구 실측

- 관련: [#96 장애 실험](https://github.com/dev-baek/bidflow/issues/96), [#86 경매 상태 재구성](./issue-086-redis-auction-recovery.md)
- 환경: 2026-11-16, BidFlow 로컬 Compose, Redis 7.4.5(AOF), Spring Boot Java 21, `local,e2e`. 기준 커밋 `34d2c11967a627d9bb6f35bae1cb3e6e7db7d0c2`.
- 범위: `bidflow-local-redis-1`만 stop/start. 동일 `bidflow-local_redis-data`를 유지했다. 기존 개발 데이터, 다른 서비스, Redis 키나 볼륨을 삭제하지 않았다.

## 결과

| 단계 | 확인 결과 |
|---|---|
| 준비 | PostgreSQL에만 존재한 활성 시험 경매의 Redis 상태 키는 없음. 첫 12,000원 입찰 뒤 키와 현재가가 생성됨 |
| Redis 중단 | 두 번째 13,000원 입찰은 HTTP `202 RECEIVED`. DB 요청은 `RECEIVED`, 해당 원장 0건. 공개 상세는 12,000원·버전 2를 유지 |
| Kafka 대기 | `bid-settlement` 파티션 2 Lag가 0 → 1, 소비 offset은 대기 중 450에 머묾 |
| Redis 재시작 | 새 요청이 `ACCEPTED`로 수렴. DB·Redis·원장 모두 13,000원, 경매 버전 3, 최고 입찰자가 승인 원장과 일치 |
| 멱등성과 복구 | 동일 키 재시도로 같은 요청 ID 반환. 새 요청의 원장·명령 Outbox·Consumer 처리 기록 각각 1건. 두 입찰의 전체 원장 2건 |
| 마무리 | 관측 Lag 0, `bid-command.DLT` 세 파티션 end offset 변화 없음. Redis `PONG`과 API readiness `UP` 확인 |

[실측 증적 JSON](evidence/issue-096-redis-outage.json)에 시험 경매·요청 ID, 공개 응답, PostgreSQL 집계, 파티션별 offset을 남겼다. Redis stop 명령 반환에서 start 명령 반환까지 약 2.66초였다. 이 값은 서비스 장애 전체 시간이나 정산 지연을 뜻하지 않는다. Lag는 전·중·후 표본이며 정확한 회복 시간은 측정하지 않았다.

## 재현 절차

1. [로컬 E2E 실행 방법](./issue-099-playwright-e2e.md)에 따라 의존성과 `local,e2e` API를 띄운다. 테스트 Clock은 12:20 UTC로 지정한다. [활성 경매 Fixture](./issue-019-focused-load-baseline.md)의 SQL을 재사용하되 새 UUID를 만들고 시작 12:10, 마감 12:55를 명시한다. `redis-cli EXISTS "auction:<경매-ID>:state"`가 0인지 확인한다.
2. 테스트 사용자 A의 직접 입찰 12,000원을 제출하고 PostgreSQL 상세와 Redis 키가 갱신될 때까지 제한적으로 조회한다. 시작 시 `BIDFLOW_CONSUMER_GROUP=bid-settlement make consumer-lag`와 `bid-command.DLT` end offsets를 기록한다.
3. `make failure-redis-stop`으로 Redis만 중단한다. 다른 테스트 사용자의 직접 입찰 13,000원을 새 키로 제출한다. Redis가 내려간 동안 공개 상세와 `bid_request.status`, `bid_ledger` 건수·Consumer Lag를 읽고 바로 `make failure-redis-start`를 실행한다. 실험 실패 시에도 장치를 원상 복구한다.
4. 새 요청이 승인될 때까지 제한적으로 조회한다. Redis Hash·공개 상세·PostgreSQL 원장을 대조하고, 같은 사용자·요청 본문·키로 재전송해 같은 요청 ID, 원장·Outbox 각 한 건을 확인한다. Lag와 DLT end offsets를 다시 조회한다.

이 실행은 짧은 Redis 재시작에서의 복구와, 별도 단계에서 키가 처음 없던 시험 경매의 상태 생성만 검증했다. 장기 장애로 재시도 소진, 기존 Redis 상태 전체 유실, Consumer 단독 중단은 검증하지 않았다. AWS 리소스는 사용하지 않았다.
