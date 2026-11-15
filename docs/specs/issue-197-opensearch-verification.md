# [Issue #197] OpenSearch 검증 모듈 사양

- 상태: 제안됨
- 관련 Issue: [#197 OpenSearch 검증 모듈 S/D/B/I/T 사양](https://github.com/dev-baek/bidflow/issues/197)
- 상위 Issue: [#89 관리형 데이터 서비스 검증 모듈](https://github.com/dev-baek/bidflow/issues/89)

## 목적과 제외 범위

AWS 검증 환경에서 상품 검색 Projection을 private OpenSearch에 연결한다. PostgreSQL은 원본이고 OpenSearch는 Kafka Event와 PostgreSQL snapshot으로 재생성 가능한 파생 읽기 모델이다. 상시 운영·public endpoint·원본 데이터 저장은 제외한다.

## S. 화면

해당 없음. domain endpoint와 index 관리 API는 Browser에 직접 노출하지 않는다.

## D. 데이터와 보안

| 항목 | 결정 |
|---|---|
| 위치 | private data subnet, application SG만 443 접근 |
| 암호화 | transit·at-rest encryption |
| 데이터 | `bidflow-products-read/write` alias와 재생성 가능한 상품 문서 |
| 장애 | 검색은 503, 등록·입찰 원장은 계속 처리 |
| 삭제 | 검증 종료 시 domain 삭제, 장기 snapshot 보존 금지 |

## B. 런타임 동작

1. Search Projection만 OpenSearch 문서를 upsert한다.
2. OpenSearch 장애는 Kafka consumer 재시도·DLT 대상이고 PostgreSQL fallback 검색으로 바꾸지 않는다.
3. index mapping 변경은 새 physical index와 alias 원자 전환으로 적용한다.

## I. Terraform 정책

- `enable_managed_search=false`가 기본이다.
- true는 Budget·TTL·삭제 검토가 끝난 verification Plan에서만 허용한다.
- development용 최소 instance와 one data node를 사용하며 HA 성능을 주장하지 않는다.
- public endpoint와 0.0.0.0/0 ingress를 만들지 않는다.

## T. 검증

| 조건 | 기대 결과 |
|---|---|
| 기본 false | 비용 domain 없음 |
| enabled true | private VPC·encryption·application SG 접근만 생성 |
| domain 중단 | search API 503, 원장 transaction 계속 가능 |
| destroy | domain과 승인 없는 snapshot 잔여 없음 |

## 완료 조건

- [x] S/D/B/I/T·파생 데이터·비용·삭제 경계를 기록했다.
- [ ] 별도 구현 이슈에서 Terraform 모듈과 계약 테스트를 추가한다.
