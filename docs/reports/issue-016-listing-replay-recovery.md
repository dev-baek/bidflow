# [Issue #16] 로컬 DLT 단일 이벤트 재처리·검색 복구 실측

- 사양: [단일 검색 이벤트 Replay](../specs/issue-016-single-event-replay.md)
- 실행일: 2026-11-19, 로컬 Apple Silicon Docker, Java 21, Spring Boot `local`(실제 시계)
- 실행 기준: `54664aa90471819212f8ff1dd6ed605adf6c9c81` — #255 병합 코드
- [실측 JSON과 감사 기록](evidence/issue-016-listing-replay.json). HTTP 업로드 URL·인증정보·전체 payload는 보관하지 않았다.

## 결과

새 상품 두 개를 실제 presigned PUT·등록 API로 생성했다. 첫 상품의 정상 색인을 확인한 뒤 OpenSearch만 중단하고, 별도의 새 시험 상품을 등록했다. 기존 사건을 재사용하거나 전체 재색인으로 복구하지 않았다.

| 단계 | 확인한 사실 |
|---|---|
| OpenSearch 중단 | 검색 HTTP 503. 새 상품 등록 HTTP 201과 `ListingPublished` Outbox 1건 확인 |
| 실패 격리 | 원본 `listing-event` partition 1 / offset 29가 `TRANSIENT_EXHAUSTED`로 `listing-event.DLT` partition 1 / offset 5에 격리됨. eventId 일치 |
| 검색 서비스 재시작 | API는 HTTP 200이지만 해당 고유 제목의 검색 결과는 0건. 해당 `search-projection` 성공 기록도 0건 |
| CLI dry-run | 레코드 검증 성공. 성공 처리 행 0건·검색 결과 0건 유지 |
| 첫 execute | 감사 기록 `ATTEMPTED → PUBLISHED`, 원본 partition 1 / 새 offset 30으로 발행됨. 같은 eventId의 성공 처리 행 1건, API 검색 결과 1건과 올바른 auctionId 확인 |
| 두 번째 execute | 같은 DLT 위치와 eventId, 새 감사 파일로 partition 1 / offset 31에 재발행. 그룹 커밋 offset이 31을 지나간 뒤에도 성공 기록 1건·검색 결과 1건. 처리 기록의 최초 source offset은 30 유지 |
| 원본·업무 상태 | DLT 해당 partition의 로그 끝은 6으로 원본 보존. 시험 경매의 입찰 원장 0건·원본 Outbox 1건 유지 |

발행 결과만으로 복구를 선언하지 않았다. Kafka ack, PostgreSQL Consumer 성공 기록, 실제 검색 API 응답을 각각 확인했다. 원본 DLT와 두 재발행 레코드의 key/value도 콘솔 출력 비교로 동일함을 확인했다. 바이트 보존 자체는 기존 순수 함수 테스트가 별도로 다룬다.

## 재현과 판정 기준

1. `make local-up-search` 후 로컬 API를 기동한다. 시험 상품은 새 UUID·고유 제목과 실제 시계 기준의 미래 경매 일정으로 준비한다. 정상 상품이 검색되는지 확인하고 DLT partition별 로그 끝을 기록한다.
2. `make failure-opensearch-stop` 뒤 새 상품을 등록한다. 해당 Outbox eventId와 새 DLT 레코드의 헤더·ID를 대조한다. 오류가 나도 `make failure-opensearch-start`로 서비스를 복구한다.
3. 검색이 HTTP 200으로 돌아와도 실패 상품은 검색되지 않는지, 해당 eventId의 `consumer_event`가 없는지 확인한다. 사양의 CLI dry-run에는 이 새 DLT 위치와 기대 ID를 넣는다.
4. 원인이 해결된 뒤 저장소 밖의 새 감사 파일로 `--execute`한다. `PUBLISHED`의 목표 offset과 PostgreSQL 처리 기록·API 결과가 일치해야 한다.
5. 멱등 검증 목적을 명시한 두 번째 실행에서는 같은 ID를 유지하고 감사 파일만 새로 만든다. `search-projection` 커밋 offset이 두 번째 발행 위치를 지난 것을 확인한 뒤 성공 행·문서 수를 대조한다.

검증 SQL은 해당 eventId·시험 경매로 범위를 한정한다.

```sql
SELECT consumer_name, event_id, source_topic, source_partition, source_offset
FROM consumer_event WHERE consumer_name = 'search-projection' AND event_id = :'event_id';
SELECT count(*) FROM bid_ledger WHERE auction_id = :'auction_id';
SELECT count(*) FROM outbox_event WHERE event_id = :'event_id';
```

## 한계와 실행 후 상태

한 번의 로컬 `ListingPublished` 일시 장애 사건이다. 다른 이벤트 종류·장기 장애·입찰 명령 재발행·AWS는 검증하지 않았다. 두 번째 발행 시 검색 효과가 다시 실행되지 않았다는 판정은 소비 완료 offset과 멱등 처리 행·문서 결과에 근거하며, OpenSearch 내부 요청 횟수를 별도로 계측하지는 않았다.

OpenSearch를 복구해 모든 BidFlow 컨테이너가 healthy인 것을 확인했다. API와 인프라는 로컬 검증에 사용할 수 있도록 실행 상태로 남겼다. 새 합성 상품과 감사 원본은 보존했으며, DB·인덱스·DLT·볼륨을 삭제하거나 그룹 offset을 재설정하지 않았다.
