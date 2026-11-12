# [Issue #27] OpenSearch 파생 데이터 전략 ADR

- 상태: 승인됨
- 작성일: 2026-11-12
- 관련 Issue: [#27 OpenSearch 파생 데이터 전략 ADR 작성](https://github.com/dev-baek/bidflow/issues/27)
- 상위 사양: [EC2 이벤트 기반 아키텍처와 ADR](./issue-002-architecture-adr.md)

## 1. 결정

OpenSearch는 상품 전문 검색, Filter, 정렬을 위한 파생 읽기 모델로만 사용한다. PostgreSQL이 상품과 경매의 원본이며, OpenSearch의 지연·중단·데이터 유실은 상품 등록과 입찰 처리를 중단시키지 않는다.

```text
PostgreSQL 상품·경매 원본
→ Outbox Event
→ Kafka
→ Projection Worker
→ OpenSearch 검색 문서
```

Kafka Consumer는 `eventId` 중복 수신을 허용하고 문서 ID를 `productId`로 고정한다. 전체 재색인은 PostgreSQL Snapshot을 기준으로 새 인덱스를 만들고 별칭을 전환한다.

이 전략은 MacBook Docker OpenSearch에서 먼저 검증한다. AWS OpenSearch 이전은 로컬 색인·재처리·전체 재색인·장애 격리 기준을 통과한 뒤 Adapter 접속 설정을 교체하는 별도 작업이다.

## 2. 일관성 모델

검색 결과는 최종적 일관성을 허용한다. 상품 등록 또는 수정 직후 검색에서 보이지 않거나 이전 값이 잠시 남을 수 있지만, 상품 상세·등록·입찰은 PostgreSQL 원본을 기준으로 처리한다.

| 상황 | 사용자 영향 | 처리 원칙 |
|---|---|---|
| 색인 지연 | 검색 결과가 잠시 이전 상태 | 재시도하고 지연을 관측 |
| 같은 이벤트 재수신 | 같은 문서 재색인 | 동일 `productId` 문서 Upsert |
| Consumer 재시작 | 처리 전 Event 재소비 | `eventId` 멱등 처리 |
| OpenSearch 중단 | 검색 API 일시 실패 또는 축소 응답 | 상품 원본·입찰은 계속 처리 |
| 인덱스 유실 | 검색 결과 없음 | PostgreSQL Snapshot으로 재색인 |

검색 결과를 입찰 가능 여부, 경매 종료 판단, 낙찰 확정의 근거로 사용하지 않는다.

## 3. 색인 계약

Projection Worker는 `ProductCreated`, `ProductUpdated`, `ProductPublished`, `AuctionStarted`, `AuctionEnded`처럼 검색 문서를 바꾸는 확정 이벤트만 소비한다. 구체적인 Event Type과 JSON 스키마는 후속 Event Contract 작업에서 확정한다.

각 색인 입력에는 다음 값을 포함한다.

```text
eventId          중복 수신 식별자
productId        OpenSearch 문서 ID
occurredAt       이벤트 발생 순서 관측값
schemaVersion    Event Contract 호환성 판단값
documentVersion  원본 행의 단조 증가 버전
```

문서 ID는 `productId` 하나로 고정한다. Projection Worker는 Create가 아니라 Upsert를 사용한다. 같은 `eventId`는 처리 완료 기록을 통해 무시하고, 다른 Event라도 낮은 `documentVersion`이면 최신 문서를 덮어쓰지 않는다.

삭제 또는 검색 제외 상태는 문서를 물리적으로 즉시 삭제하지 않고 `searchable=false`와 원본 버전을 색인한다. 검색 Query는 `searchable=true`만 반환한다. 보존·삭제 기간은 개인정보 및 운영 정책이 확정되는 후속 작업에서 결정한다.

## 4. Consumer 처리와 재시도

```text
Kafka Event 수신
→ Event Contract 검증
→ eventId 처리 여부 확인
→ PostgreSQL 원본 또는 Event Payload로 검색 문서 생성
→ OpenSearch Upsert
→ eventId 처리 완료 기록
→ Kafka Offset Commit
```

OpenSearch Upsert가 실패하면 처리 완료 기록과 Offset을 Commit하지 않는다. Consumer는 지수 Backoff로 재시도하고, 정해진 횟수를 넘으면 실패 Event를 격리 Topic 또는 재처리 저장소로 보낸다. 실패 Event는 원인 수정 후 같은 `eventId`로 재처리한다.

원본 조회가 필요할 때 Projection Worker는 PostgreSQL Snapshot을 읽는다. 원본이 이미 삭제됐거나 버전이 맞지 않으면 임의의 빈 문서를 만들지 않고 실패 원인을 기록해 재처리한다.

## 5. 전체 재색인

일상적인 이벤트 재처리와 전체 재색인은 구분한다. 전체 재색인은 Mapping 변경, 대량 유실, 문서 생성 버그 수정에만 사용한다.

1. 새 버전 이름의 인덱스를 생성한다. 예: `products-v3`.
2. PostgreSQL의 일관된 Snapshot에서 검색 가능한 상품을 페이지 단위로 읽는다.
3. `productId`와 `documentVersion`을 포함해 Bulk Upsert 한다.
4. 대상 문서 수, 실패 수, 샘플 Query 결과를 검증한다.
5. 읽기 Alias `products-read`를 새 인덱스로 원자 전환한다.
6. 재색인 시작 시점 이후의 Kafka Event를 새 인덱스에 반영한다.
7. 이전 인덱스는 즉시 삭제하지 않고 검증 기간 후 제거한다.

쓰기 중단 없이 재색인하려면 시작 시점과 Kafka Offset을 기록한다. Snapshot 완료 뒤 그 Offset 이후 Event를 따라잡은 뒤 Alias를 전환한다. 이 절차는 동일 문서의 중복 생성을 허용하지 않는다.

## 6. 장애 격리와 복구

OpenSearch 연결 실패는 Projection Worker의 재시도·격리 대상이며 API의 상품 등록 Transaction 또는 Bid Worker의 PostgreSQL Transaction을 롤백시키지 않는다.

검색 API는 OpenSearch 장애를 명확한 일시 오류로 반환한다. PostgreSQL로 임의의 부분 검색을 대체하지 않는다. 두 저장소의 검색 문법·정렬 결과가 달라 사용자 기대를 깨고 부하를 원장에 전가하기 때문이다.

복구 순서는 다음과 같다.

1. OpenSearch Cluster Health와 디스크·메모리 원인을 확인한다.
2. Projection Worker를 재시작하고 Consumer Lag을 확인한다.
3. 격리된 실패 Event를 재처리한다.
4. 인덱스 유실 또는 Mapping 불일치가 확인되면 전체 재색인을 실행한다.
5. Alias 전환 후 검색 Query, 문서 수, 최신 Event 반영을 확인한다.

## 7. 로컬 검증 기준

| 시나리오 | 기대 결과 |
|---|---|
| 같은 `eventId` 두 번 수신 | 문서 하나만 존재하고 결과가 변하지 않음 |
| 낮은 `documentVersion` Event 지연 도착 | 최신 문서를 덮어쓰지 않음 |
| Consumer 중단 후 재시작 | Commit 전 Event를 다시 받아 색인 완료 |
| OpenSearch 중단 중 상품 등록 | PostgreSQL 원본 저장은 성공하고 색인만 지연 |
| 색인 데이터 삭제 | PostgreSQL Snapshot으로 동일 문서 수 복구 |
| 새 인덱스 재색인 | Alias 전환 뒤 검색 결과가 새 인덱스를 조회 |

로컬 `make local-up-search` 환경에서 이 시나리오를 Adapter 통합 테스트와 장애 실험으로 남긴다. 문서 Field Mapping·Analyzer·Query DSL·성능 비교는 후속 #55와 #63에서 다룬다.

## 8. 대안과 전환 조건

### PostgreSQL 검색만 사용

초기 구현은 단순하지만 전문 검색, Filter, 정렬 요구가 커지면 원장 Query가 복잡해지고 검색 실험을 보여주기 어렵다. MVP의 검색 요구를 위해 OpenSearch를 선택한다.

### OpenSearch를 원본으로 사용

색인 실패·지연·유실이 상품과 입찰의 최종 사실을 바꾸게 되므로 제외한다.

### AWS OpenSearch로 즉시 시작

로컬에서 오류·재색인 절차를 검증하기 전에 비용과 운영 변수를 추가한다. 로컬 검증이 끝난 뒤에만 AWS 배포 작업을 진행한다.

## 9. 완료 조건

- [x] OpenSearch가 파생 읽기 모델임을 명시했다.
- [x] 색인 지연과 장애가 원장·입찰에 영향을 주지 않는 경계를 정의했다.
- [x] `eventId`, `productId`, `documentVersion` 멱등 계약을 정의했다.
- [x] 재시도·실패 격리·Consumer 재시작 기준을 정의했다.
- [x] Snapshot·Kafka Offset·Alias 기반 전체 재색인 절차를 정의했다.
- [x] 로컬 우선 검증과 AWS 이전 조건을 기록했다.
