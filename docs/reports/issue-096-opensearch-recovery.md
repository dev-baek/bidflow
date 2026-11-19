# [Issue #96] 로컬 OpenSearch 장애·복구 실측

- 관련: [#96 장애 실험](https://github.com/dev-baek/bidflow/issues/96), [#19 부하·장애 검증](https://github.com/dev-baek/bidflow/issues/19)
- 환경: 2026-11-16, Apple Silicon, `bidflow-local` Docker Compose, Spring Boot `local,e2e`, Java 21. 실행 기준 커밋 `c74c0a2be0217c17a20107a7f1ec53b90bee1d16`.
- 범위: 로컬 OpenSearch 컨테이너 한 개만 stop/start. Kafka·Redis·PostgreSQL·SeaweedFS와 Spring Boot는 계속 실행했다. 컨테이너·볼륨·인덱스·DLT 메시지는 삭제하지 않았다.

## 실제 결과

| 단계 | 확인 결과 |
|---|---|
| 중단 전 | 새 등록 상품이 실제 검색에서 등록 응답과 같은 경매 ID를 반환 |
| 중단 중 검색 | HTTP `503 SEARCH_UNAVAILABLE` |
| 중단 중 등록 | 실제 로컬 이미지 PUT 뒤 HTTP `201`. 경매와 `ListingPublished` Outbox가 PostgreSQL에 저장되고 이벤트 발행을 확인 |
| 중단 중 입찰 | 기존 경매에 직접 입찰. HTTP `202 RECEIVED` 뒤 승인 원장 1건, 공개 상세·DB 현재가 모두 12,000원 |
| 실패 격리 | 장애 중 등록 이벤트가 `listing-event.DLT`에 한 건 추가. 원본 이벤트 ID·토픽·파티션·offset이 일치하고 `TRANSIENT_EXHAUSTED` 확인 |
| OpenSearch 재시작 | 기존 검색 결과는 돌아왔지만 장애 중 등록한 상품은 검색 결과 0건. Search Projection Lag 조회는 6개 파티션 모두 0이었고, 해당 이벤트의 성공 처리 행은 0건 |
| PostgreSQL 기반 재색인 | 로컬 전체 재색인 응답 `indexedCount=176`. 장애 중 상품이 등록 응답과 동일한 경매 ID로 다시 검색됨 |

**Lag 0은 색인이 모두 성공했다는 뜻이 아니다.** 재시도를 소진한 이벤트가 DLT에 보존된 뒤 원본 offset이 진행돼, 검색 문서가 없어도 Lag가 0일 수 있었다. 이 실행은 PostgreSQL에서 문서를 다시 구성하는 절차를 검증했으며, DLT 이벤트 재발행·자동 복구는 검증하지 않았다.

후속: [#16 단일 이벤트 재처리 실측](issue-016-listing-replay-recovery.md)은 새 시험 상품의 실패 사건을 따로 만들고, 전체 재색인 없이 DLT 재발행과 중복 처리를 검증했다. 이 보고서의 과거 실험과는 별도 실행이다.

[실측 값과 DLT 헤더 증적](evidence/issue-096-opensearch-outage.json)에는 시험용 UUID와 확인된 헤더만 담았다. presigned URL이나 전체 스택 트레이스는 보관하지 않았다. 통제 시계의 `x-failed-at`은 실험 시각이며 실제 장애 지속 시간을 뜻하지 않는다.

## 재현 절차

1. 기존 [로컬 E2E 실행 방법](./issue-099-playwright-e2e.md)에 따라 `make local-up-search`와 `local,e2e` Spring Boot를 준비한다. 테스트 전용 Clock을 12:00 UTC로 놓고, 고유 제목인 시험 상품을 이미지 업로드 포함해 API로 등록한다. 시작 12:10, 마감 12:45로 설정한 뒤 실제 검색에서 동일 경매 ID를 확인한다.
2. Clock을 12:20으로 옮기고 DLT 로그 끝 offset을 기록한 뒤 `make failure-opensearch-stop`으로 검색만 내린다. 검색의 503을 확인하고, 새 고유 제목으로 시작 12:31·마감 13:00인 상품을 등록한다. 기존 경매에 다른 테스트 사용자의 12,000원 입찰을 제출한다. 공개 상세와 PostgreSQL 승인 원장을 조회한다.
3. 실패 재시도가 소진될 때까지 제한적으로 DLT end offset을 조회한다. 새 이벤트만 읽어 Outbox의 `event_id`와 대조하고, 헤더에서 원본 위치와 실패 분류를 확인한다. 실험이 실패하더라도 `make failure-opensearch-start`로 검색을 되돌린다.
4. OpenSearch가 정상인 상태에서 기존 상품과 새 상품의 검색 결과를 비교하고 `BIDFLOW_CONSUMER_GROUP=search-projection make consumer-lag`를 호출한다. 실제 재색인이 필요할 때만 다음 로컬 명령을 실행하고, 새 상품의 경매 ID가 검색될 때까지 제한적으로 조회한다.

```sh
curl -fsS -X POST -H 'X-Actor-Id: e2e-search-outage-recovery' \
  'http://127.0.0.1:8080/api/internal/search/reindex?pageSize=100'
```

재색인은 현재 로컬 PostgreSQL을 기준으로 검색 문서를 갱신하며, 원장이나 인덱스 볼륨을 초기화하지 않는다. Redis 장애와 API를 유지한 Consumer 단독 장애는 아직 별도 실측이 필요하다. AWS 리소스는 사용하지 않았다.
