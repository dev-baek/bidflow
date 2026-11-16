# [Issue #96] 로컬 입찰 정산 Consumer 단독 중단·복구 실측

- 이슈: [#96 장애 실험](https://github.com/dev-baek/bidflow/issues/96), [#19 부하·장애 검증](https://github.com/dev-baek/bidflow/issues/19)
- 사양: [Consumer 단독 중단·복구](../specs/issue-096-settlement-consumer-outage.md)
- 환경: 2026-11-16, Apple Silicon·BidFlow 로컬 Compose·Spring Boot Java 21. `efde0c1d29f04cf148e2e89bc55fbda4e92fa5b9` + 이 PR의 Listener 제어. 서버 Clock은 2030-01-01 12:20 UTC로 통제했다.

## 결과

| 단계 | 관측값 |
|---|---|
| 시작 | 정산·검색 그룹 각각 `Stable / 1`, 정산 Lag 0, 공개 현재가 12,000원·버전 2 |
| 정산 Listener만 중단 | 정산 그룹 `Empty / 0`. API readiness `UP`, 검색 그룹 `Stable / 1` |
| 중단 중 입찰 3건 | 모두 `202 RECEIVED`. Outbox 명령 3건 발행, DB 요청 `RECEIVED` 3건, 해당 원장 0건. 공개 현재가·버전 불변 |
| 중단 중 Lag | `bid-command` 파티션 2의 커밋 offset 452 유지, 로그 끝 452 → 455, Lag 3 |
| 재시작 후 | 정산 그룹 `Stable / 1`, Lag 0. 13,000·14,000·15,000원 모두 승인, 현재가 15,000원·버전 5 |
| 멱등성과 정합성 | 마지막 요청 재시도는 같은 요청 ID·새 Outbox 없음. 대기했던 3건 모두 원장 각 1건, 최고 입찰자가 최종 승인 원장과 일치. 해당 DLT end offsets는 그대로 |

재시작 호출 반환 약 5.32초 뒤 첫 Lag 0을 관측했다. 실제 회복 시점의 정확한 측정값은 아니다. 정산 Listener를 내린 동안 API와 Outbox는 실행된 상태였다. 시험 이후 로컬 서버를 기본 설정(제어 경로 비활성)으로 다시 띄웠다. [실측 증적 JSON](evidence/issue-096-settlement-consumer-outage.json)은 시험용 경매·요청과 카운터만 포함한다.

## 재현

1. 루프백 전용으로 바인딩하고 로컬에서만 실험용 설정을 적용한다. 일반 E2E 및 배포에서는 활성화하지 않는다.

```sh
SERVER_ADDRESS=127.0.0.1 SERVER_FORWARD_HEADERS_STRATEGY=none \
SPRING_PROFILES_ACTIVE=local,e2e BIDFLOW_E2E_BID_SETTLEMENT_CONTROL_ENABLED=true \
  ./backend/gradlew -p backend :runtime:bootRun
```

2. 시험 경매를 준비하고 12,000원 입찰을 확정한다. 정산 그룹 활성 멤버가 1이고 Lag가 0인지 확인한다. 기존 [Redis 실험](issue-096-redis-recovery.md)의 시험용 Clock·활성 경매 준비를 재사용할 수 있다.
3. 로컬 개발 ID가 있는 `POST /api/internal/e2e/bid-settlement/stop`을 호출한다. 성공 응답만으로 진행하지 않고 정산 그룹이 `Empty / 0`이 될 때까지 확인한다. 다른 사용자의 13,000·14,000·15,000원 입찰과 DB·Lag를 대조한다.
4. 같은 경로의 `/start`를 호출한다. 중간 검증이 실패해도 이 복구 호출부터 실행한다. 해당 그룹 Lag와 건별 최종 판정·원장을 확인한 뒤 테스트 플래그를 비활성화한다. 프로세스·다른 Listener·broker를 중단하거나 offset·볼륨·기존 데이터를 삭제하지 않는다.

Redis·OpenSearch 실험 증적과 함께 #96을 충족한다. 이번 실험은 로컬의 단일 활성 Consumer를 대상으로 했으며 AWS·다중 인스턴스 장애 복구 결과로 해석하지 않는다.
