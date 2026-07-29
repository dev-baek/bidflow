# [Issue #1] BidFlow 프로젝트 범위와 성공 기준

- 상태: Review
- 작성일: 2026-07-28
- 개정일: 2026-07-29 — EC2·ALB·RDS PostgreSQL 구조로 전환
- 상위 Issue: [#1 BidFlow 프로젝트 범위와 성공 기준 확정](https://github.com/dev-baek/bidflow/issues/1)
- 사양 작업: [#22 제품 목표·사용자·MVP 범위 사양 작성](https://github.com/dev-baek/bidflow/issues/22)
- 전환 사양: [#107 EC2·ALB 기반 아키텍처 전환 사양 작성](https://github.com/dev-baek/bidflow/issues/107)

## 1. 문제 정의

온라인 경매에서는 종료 직전에 입찰이 집중되고, 거의 동시에 도착한 입찰의 처리 순서가 낙찰 결과에 직접 영향을 준다. 입찰 처리 과정이 검색 색인, 알림, 통계와 강하게 결합되면 부가 기능의 장애가 핵심 입찰까지 실패시킬 수 있다.

BidFlow는 다음 문제를 해결하는 AWS 기반 종합 중고 경매 플랫폼이다.

1. 동일 경매에 집중되는 입찰을 유실하지 않고 순서대로 처리한다.
2. 직접 입찰과 최대 금액 기반 자동 입찰의 가격을 일관되게 계산한다.
3. 중복 메시지와 재시도 상황에서도 입찰 원장을 한 번만 반영한다.
4. 검색·실시간 전파·통계를 핵심 입찰 처리와 분리한다.
5. 장애가 발생한 파생 데이터를 원본 데이터와 이벤트로 복구한다.
6. 검증할 때만 고비용 AWS 리소스를 생성해 월 10만 원 예산을 지킨다.

## 2. 프로젝트 목표

### 2.1 사용자 목표

- 판매자는 다양한 카테고리의 중고 상품을 경매로 등록할 수 있다.
- 구매자는 상품을 검색하고 직접 입찰 또는 자동 입찰에 참여할 수 있다.
- 참여자는 최고가와 입찰 결과를 실시간으로 확인할 수 있다.
- 경매 종료 시 시스템이 낙찰자 또는 유찰 결과를 자동으로 확정한다.

### 2.2 포트폴리오 목표

- AWS ALB·EC2 Auto Scaling·RDS와 관리형 데이터 서비스의 역할을 실제 배포로 설명한다.
- Kafka, Redis, OpenSearch를 선택한 이유와 사용하지 않을 조건을 설명한다.
- 비동기 처리, 순서 보장, 멱등성, 최종적 일관성, 장애 복구를 코드와 실험으로 증명한다.
- TDD와 순수한 도메인 함수로 입찰 규칙과 화면 상태 전이를 재현 가능한 테스트로 증명한다.
- 성능과 비용을 측정하고 기술 선택의 장점뿐 아니라 단점도 기록한다.

## 3. 대상 사용자

### 3.1 판매자

- 중고 상품의 이미지와 정보를 등록한다.
- 시작가와 경매 기간을 설정한다.
- 진행 상태, 현재가, 입찰 수와 낙찰 결과를 확인한다.

### 3.2 구매자

- 키워드와 조건으로 상품을 검색한다.
- 직접 입찰가 또는 최대 자동 입찰가를 제출한다.
- 입찰 접수와 최종 처리 결과를 확인한다.
- 경매 종료 후 낙찰 또는 패찰 결과를 확인한다.

### 3.3 운영자

MVP에서는 별도의 운영자 CRUD 화면을 만들지 않는다. CloudWatch Dashboard와 실패 이벤트 조회 도구를 운영 화면으로 사용한다.

## 4. 핵심 용어

| 용어 | 정의 |
|---|---|
| 상품 | 판매자가 등록한 중고 물품 정보 |
| 경매 | 상품의 시작가, 시작·종료 시각과 상태를 관리하는 거래 단위 |
| 직접 입찰 | 사용자가 현재 유효 최소 금액 이상의 공개 입찰가를 제출하는 방식 |
| 자동 입찰 | 사용자가 최대 지불 금액을 등록하면 시스템이 최소 입찰 단위로 현재가를 계산하는 방식 |
| 현재가 | 현재 최고 입찰자가 승리 상태를 유지하는 데 필요한 공개 가격 |
| 입찰 원장 | 승인·거절된 입찰 명령과 계산 결과를 영구 보관한 기록 |
| 파생 데이터 | PostgreSQL 원본에서 다시 만들 수 있는 Redis 상태와 OpenSearch 인덱스 |
| 입찰 명령 | 처리 전 상태로 Kafka에 기록된 사용자의 입찰 요청 |
| 도메인 이벤트 | 입찰 승인, 최고 입찰자 변경, 경매 종료 등 확정된 사실 |

## 5. MVP 범위

### 5.1 반드시 구현

1. Cognito 회원가입과 로그인
2. S3 Presigned URL 기반 상품 이미지 업로드
3. 상품과 경매 등록
4. OpenSearch 기반 상품 전문 검색, 필터와 정렬
5. Kafka 기반 비동기 입찰 접수
6. 직접 입찰
7. 최대 금액 기반 자동 입찰
8. Redis Lua Script 기반 원자적 가격 계산
9. RDS PostgreSQL 입찰 원장과 멱등성 처리
10. Spring WebSocket 기반 입찰 결과와 현재가 전파
11. 마감 5분 미만에 승인된 입찰의 경매 종료 시각 5분 자동 연장
12. PostgreSQL 잠금 기반 경매 종료 Scheduler
13. 낙찰·유찰 결과 확정
14. Consumer 재시도와 실패 이벤트 격리
15. Redis 상태 복구와 OpenSearch 전체 재색인
16. CloudWatch 로그, 지표, Dashboard와 Alarm
17. Terraform 기반 AWS 검증 환경 생성·삭제
18. 동시 입찰 부하 테스트와 장애 복구 실험

### 5.2 시간이 남으면 구현

- 상품 검색 자동완성
- 관심 상품
- 이메일 알림
- 판매자 통계 화면
- WAF 기반 추가 요청 제한

### 5.3 구현하지 않음

- 실제 결제와 정산
- 배송과 운송장 추적
- 판매자·구매자 채팅
- 리뷰와 평점
- 신고, 분쟁과 환불
- 쿠폰, 포인트와 광고
- 모바일 네이티브 애플리케이션
- 다중 리전 재해 복구
- Kubernetes

## 6. 핵심 사용자 흐름

### 6.1 상품 등록

1. 판매자가 로그인한다.
2. 상품 정보, 경매 기간과 시작가를 입력한다.
3. Presigned URL을 발급받아 이미지를 S3에 직접 업로드한다.
4. 등록 API가 이미지와 입력값을 검증하고 PostgreSQL에 Outbox와 함께 저장한다.
5. Outbox Publisher가 `ListingPublished` 이벤트를 Kafka에 발행한다.
6. Projection Worker가 OpenSearch에 상품을 색인한다.

### 6.2 상품 검색

1. 구매자가 검색어와 필터를 입력한다.
2. Spring Boot API가 OpenSearch를 조회한다.
3. 화면에 검색 결과 또는 결과 없음·장애 상태를 표시한다.
4. OpenSearch 장애는 상품 등록과 입찰 처리에 영향을 주지 않는다.

### 6.3 직접·자동 입찰

1. 구매자가 직접 입찰가 또는 최대 자동 입찰가를 제출한다.
2. Spring Boot API가 요청을 검증하고 `202 Accepted`와 `bidRequestId`를 반환한다.
3. PostgreSQL에 입찰 요청과 Outbox를 저장하고 Publisher가 `auctionId`를 Kafka Key로 `bid-command`에 발행한다.
4. Bid Engine이 같은 경매의 명령을 파티션 순서대로 소비한다.
5. Redis Lua Script가 승자와 현재가를 원자적으로 계산한다.
6. 처리 결과, 입찰 원장과 Outbox를 PostgreSQL Transaction으로 저장한다.
7. 승인 시 남은 시간이 5분 미만이면 현재 종료 시각에 5분을 추가한다.
8. `BidAccepted`, `BidRejected` 또는 `AuctionExtended` 이벤트를 발행한다.
9. Redis Pub/Sub과 Spring WebSocket이 사용자에게 최종 결과와 변경된 종료 시각을 전송한다.

### 6.4 경매 종료

1. Spring Scheduler가 종료 시각이 지난 진행 중 경매를 조회한다.
2. PostgreSQL `FOR UPDATE SKIP LOCKED`로 하나의 Worker가 종료 대상을 점유한다.
3. 마지막 유효 입찰과 경매 상태를 확인한다.
4. 낙찰자 또는 유찰 결과와 Outbox를 한 번만 저장한다.
5. 종료 이벤트가 Kafka를 거쳐 검색 인덱스와 실시간 화면에 반영된다.

## S. 화면 범위

| 화면 | 필수 상태 |
|---|---|
| 로그인 | 초기, 처리 중, 인증 실패, 세션 만료 |
| 상품 목록·검색 | 초기, 검색 중, 결과, 결과 없음, 검색 장애 |
| 상품 등록 | 입력 중, 이미지 업로드, 제출 중, 검증 실패, 등록 성공 |
| 상품 상세·입찰 | 연결 중, 입찰 접수, 처리 대기, 승인, 거절, 자동 연장, 연결 끊김, 종료 |
| 내 경매 | 예정, 진행 중, 종료, 낙찰, 유찰 |

UI의 목표는 기능의 기술적 흐름을 분명하게 보여주는 것이다. 디자인 시스템 구축이나 복잡한 애니메이션은 범위에서 제외한다.

프론트엔드는 React.js와 TypeScript로 구현한다. 화면 상태는 컴포넌트 내부의 임의 분기보다 명시적인 상태 모델, 순수 Reducer와 Selector로 표현하며 상태 전이 테스트를 작성한다.

## D. 데이터 범위

### 8.1 최종 원본

RDS PostgreSQL에 다음 데이터를 영구 보관한다.

- 사용자 참조 정보
- 상품과 경매
- 자동 입찰 설정
- 입찰 요청 처리 상태
- 입찰 원장
- 낙찰 결과
- Transactional Outbox
- Consumer 멱등 처리 기록
- 실패 이벤트와 재처리 상태

### 8.2 파생 데이터

- Redis: 활성 경매의 자동 입찰자, 최대 금액, 현재가와 요청 제한
- OpenSearch: 상품 검색 문서
- CloudWatch: 운영 로그와 지표

Redis와 OpenSearch 데이터는 PostgreSQL 원본으로 복원할 수 있어야 한다.

### 8.3 정합성 원칙

- Kafka 전달 방식은 At-least-once로 가정한다.
- 모든 명령에 `bidRequestId`, 모든 이벤트에 `eventId`를 사용한다.
- Consumer는 같은 `eventId`를 반복 수신해도 결과가 달라지지 않아야 한다.
- 동일 경매의 메시지는 `auctionId` Key로 같은 파티션에 전달한다.
- 순서 보장 범위는 전체 시스템이 아니라 동일 Kafka 파티션 내부다.
- 검색과 실시간 화면은 최종적 일관성을 허용한다.
- 낙찰 결과와 입찰 원장은 최종 원장으로 취급한다.

## B. 백엔드 범위

### 9.1 API 성격

- 인증·상품·검색 API: 결과를 동기 응답한다.
- 입찰 API: 접수 결과만 동기 응답하고 최종 결과는 비동기 처리한다.
- 입찰 최종 결과는 WebSocket과 상태 조회 API로 제공한다.

### 9.2 이벤트 종류

- `ListingPublished`
- `ListingUpdated`
- `BidCommandReceived`
- `BidAccepted`
- `BidRejected`
- `HighestBidderChanged`
- `AuctionExtended`
- `AuctionCloseRequested`
- `AuctionClosed`
- `WinnerDetermined`

모든 이벤트는 `eventId`, `schemaVersion`, `occurredAt`, `correlationId`를 포함한다.

### 9.3 오류 처리 원칙

- 사용자 입력 오류와 시스템 오류를 구분한다.
- 재시도로 해결 가능한 오류만 제한적으로 재시도한다.
- 처리 불가능한 이벤트는 실패 저장소에 격리한다.
- WebSocket 전송 실패가 입찰 결과를 되돌리지 않는다.
- OpenSearch 장애가 상품 원본과 입찰을 막지 않는다.
- 경매 종료 작업은 중복 실행돼도 같은 결과를 반환한다.

### 9.4 경매 자동 연장 규칙

- 입찰이 최종 승인된 시각을 기준으로 남은 시간이 5분 미만이면 자동 연장한다.
- 연장 시 새로운 종료 시각은 기존 종료 시각에 5분을 더한 값이다.
- 남은 시간이 정확히 5분이면 연장하지 않는다.
- 거절되거나 중복 처리된 입찰은 연장하지 않는다.
- 연장된 종료 시각을 기준으로 이후 유효 입찰도 같은 규칙을 반복 적용한다.
- 반복 연장 횟수에는 상한을 두지 않는다.
- PostgreSQL 종료 시각 갱신은 낙관적 잠금 또는 조건부 갱신으로 멱등하게 처리한다.
- Scheduler는 항상 PostgreSQL의 최신 종료 시각을 조회하므로 자동 연장 시 별도 예약 작업을 갱신하지 않는다.

## I. AWS와 기술 범위

| 기술 | 역할 | 선택 이유 |
|---|---|---|
| React.js·TypeScript·Vite | 사용자 화면과 정적 웹 빌드 | 타입이 있는 상태 모델과 빠른 테스트, S3·CloudFront 정적 배포 |
| Java·Spring Boot | REST·WebSocket·Worker·Scheduler | 국내 백엔드 채용 범용성, 장기 실행 Kafka Consumer와 테스트 생태계 |
| ALB | HTTPS·Health Check·부하 분산 | 여러 EC2의 정상 Target에 REST와 WebSocket 전달 |
| EC2 Auto Scaling | Spring Boot 실행 | OS·JVM·배포·확장 경험과 장기 실행 Process 운영 |
| Cognito | 사용자 인증 | 인증 인프라보다 경매 도메인에 집중 |
| RDS PostgreSQL | 최종 원장 | 관계·Transaction·잠금·SQL 실행 계획과 Spring Data 경험 |
| MSK Serverless | 입찰 명령·이벤트 스트림 | 경매별 순서, 다중 Consumer, 이벤트 재생 |
| ElastiCache | 활성 경매 계산 | Sorted Set과 Lua의 원자 연산으로 자동 입찰 계산 |
| OpenSearch Serverless | 상품 검색 | 전문 검색, 필터, 정렬과 재색인 |
| S3 | 상품 이미지 | Presigned URL로 애플리케이션 서버 중계 제거 |
| CloudFront | 정적 웹·이미지 전달 | 원본 노출 축소와 캐시 |
| ECR | Spring Boot Image | Digest 기반 배포 Artifact 보관 |
| Systems Manager | EC2 운영 접속 | SSH Port와 장기 운영 Key 제거 |
| CloudWatch | 로그·지표·알람 | 실패·지연 탐지와 검증 증적 |
| Terraform | IaC | 검증 환경 재현과 고비용 리소스 삭제 자동화 |

### 10.1 비용 원칙

- 월 예산 상한은 100,000원이다.
- 80,000원 예상 비용에서 경고한다.
- ALB, EC2, NAT Gateway, RDS, MSK, ElastiCache와 OpenSearch는 AWS 통합 검증 시에만 생성한다.
- 로컬 개발에서는 Docker 기반 PostgreSQL, Kafka, Redis와 OpenSearch를 사용한다.
- 검증 종료 후 Terraform Destroy와 별도 잔존 리소스 점검을 수행한다.
- NAT Gateway, Elastic IP, 로그 보존 등 간접 비용도 점검한다.

## T. 개발과 테스트 원칙

### 11.1 TDD 작업 순서

모든 기능, 수정과 리팩터링은 다음 순서를 지킨다.

1. 요구사항의 한 가지 동작을 나타내는 실패 테스트를 먼저 작성한다.
2. 테스트가 구현 부재 때문에 예상한 이유로 실패하는지 확인한다.
3. 테스트를 통과시키는 최소한의 구현만 작성한다.
4. 전체 테스트가 통과하는 상태에서 중복과 표현을 리팩터링한다.
5. 정상, 오류와 시간·금액·중복 처리 경계를 같은 방식으로 반복한다.

테스트를 나중에 추가한 코드는 TDD 완료로 간주하지 않는다. PR에는 첫 실패 테스트, 최종 통과 결과와 필요한 경우 장애 재현 증적을 남긴다.

### 11.2 Functional Core / Imperative Shell

“모든 함수를 순수 함수로 만든다”는 목표는 외부 시스템 호출까지 숨기는 것이 아니라, 변경 가능한 효과를 경계로 밀어내는 방식으로 적용한다.

#### 순수 함수로 구현하는 영역

- 직접·자동 입찰 가격 계산
- 입찰 승인·거절 판정
- 경매 자동 연장 종료 시각 계산
- 경매 상태 전이와 낙찰 판정
- 이벤트 생성에 필요한 도메인 데이터 변환
- React Reducer, Selector와 화면 표시 모델 변환

순수 함수는 같은 입력에 항상 같은 결과를 반환하고 입력을 변경하지 않는다. 시스템 시각, UUID, 난수와 설정은 함수 안에서 직접 읽지 않고 인자로 전달한다. 전역 변경 상태와 숨겨진 Singleton 상태를 사용하지 않는다.

#### 효과를 허용하는 경계 영역

- Spring MVC·WebSocket·Kafka Listener와 Scheduler 진입점
- PostgreSQL, Kafka, Redis와 OpenSearch Adapter
- 파일, 로그, 네트워크와 시스템 시각 접근
- React API Client, 브라우저 저장소와 WebSocket 연결

경계 코드는 입력을 읽고 순수한 핵심 함수를 호출한 뒤 결과를 외부에 반영하는 얇은 Imperative Shell로 유지한다. 외부 연동은 Port 인터페이스 뒤로 격리하고 Test Double로 대체할 수 있어야 한다.

### 11.3 백엔드 테스트 스택과 범위

| 도구 | 역할 |
|---|---|
| JUnit 5 | 도메인 단위 테스트와 경계값 테스트 |
| AssertJ | 읽기 쉬운 검증 표현 |
| Mockito | 외부 Port 호출과 실패 흐름 검증에 한정 |
| Testcontainers | Kafka, Redis와 OpenSearch Adapter 통합 테스트 |
| Spring Boot Test | HTTP 진입점과 구성 연결 검증 |

- 도메인 테스트는 Spring Context 없이 빠르게 실행돼야 한다.
- Mock은 순수한 도메인 계산에 사용하지 않고 외부 효과 경계에만 사용한다.
- 시간 기반 규칙은 고정된 `Clock` 또는 명시적인 `Instant` 입력으로 검증한다.
- 멱등성과 순서 보장은 동일 명령 반복, 순서가 다른 명령과 재시도 시나리오로 검증한다.

### 11.4 프론트엔드 테스트 스택과 상태 원칙

| 도구 | 역할 |
|---|---|
| Vitest | TypeScript 단위 테스트와 상태 전이 테스트 |
| React Testing Library | 사용자 관점의 컴포넌트 동작 검증 |
| MSW | REST·WebSocket 주변 API 성공·실패 응답 대체 |
| Playwright | 핵심 사용자 흐름 E2E와 실제 브라우저 검증 |

- 로딩, 성공, 빈 결과, 오류, 재시도와 연결 끊김 상태를 명시적으로 모델링한다.
- 상품 상세 화면은 입찰 접수, 처리 대기, 승인, 거절, 자동 연장과 종료 상태 전이를 테스트한다.
- 서버 데이터에서 계산할 수 있는 값은 별도 State와 Effect로 복제하지 않고 Selector 또는 렌더링 과정에서 파생한다.
- 이전 값에 의존하는 갱신은 함수형 상태 업데이트 또는 Reducer를 사용한다.
- Effect는 외부 시스템과의 동기화에만 사용하고 이벤트 처리와 순수 계산을 대신하지 않는다.
- 상태 테스트는 구현 내부가 아니라 입력 이벤트, 이전 상태와 다음 상태의 계약을 검증한다.

## 12. 성공 기준

### 12.1 기능

- 상품 등록부터 검색, 직접 입찰, 자동 입찰, 종료와 낙찰까지 E2E 시나리오가 통과한다.
- OpenSearch 장애 중에도 상품 원본과 입찰 처리는 계속된다.
- Redis 상태를 삭제한 후 활성 경매 상태를 복구할 수 있다.
- Consumer 중단 후 재시작해도 이벤트가 누락되지 않는다.

### 12.2 정합성

- 동일 `bidRequestId`를 100회 전송해도 입찰 원장은 한 번만 반영된다.
- 동일 경매에 1,000건의 동시 입찰을 전송해도 현재가가 역행하지 않는다.
- 동일 이벤트를 반복 소비해도 낙찰 결과와 검색 문서가 중복되지 않는다.
- 한 경매에서 동시에 둘 이상의 낙찰자가 생성되지 않는다.
- 마감 5분 미만에 승인된 입찰마다 종료 시각이 정확히 5분씩 연장된다.
- 거절 입찰, 중복 이벤트와 남은 시간 5분 이상의 입찰은 종료 시각을 변경하지 않는다.

### 12.3 성능

- 입찰 접수 API P95: 300ms 이하
- 정상 상태의 입찰 접수부터 최종 결과 WebSocket 전달 P95: 2초 이하
- 부하 종료 후 Kafka Consumer Lag: 60초 안에 0으로 회복

성능 목표는 포트폴리오 검증 환경의 기준이며 상용 SLA를 의미하지 않는다.

### 12.4 운영과 비용

- CloudWatch에서 입찰 실패율, 처리시간, ALB Target 상태, EC2·JVM 오류와 Consumer Lag을 확인할 수 있다.
- 테스트 알람을 발생시키고 수신 여부를 확인한다.
- Terraform으로 AWS 검증 환경을 반복 생성·삭제할 수 있다.
- 검증 종료 후 의도하지 않은 고정비 리소스가 남지 않는다.
- 실제 비용을 보고서에 기록하고 100,000원 이하임을 확인한다.

### 12.5 개발 품질

- 모든 기능 PR이 실패 테스트부터 시작한 Red–Green–Refactor 증적을 포함한다.
- 핵심 도메인 모듈은 Spring Context와 AWS SDK 없이 단위 테스트할 수 있다.
- 시스템 시각과 ID 생성기를 주입해 동일 입력의 테스트 결과를 재현할 수 있다.
- React 핵심 화면의 상태 Reducer와 Selector에 상태 전이 테스트가 있다.
- 핵심 사용자 흐름은 Playwright로 실제 브라우저에서 검증한다.

## 13. 4주 완료 경계

### 1주차

- 프로젝트 범위와 아키텍처 사양
- 로컬 개발 환경
- 백엔드·프론트엔드 TDD 기반과 테스트 규칙
- Terraform 기반
- Cognito 인증

### 2주차

- 상품·경매 데이터 모델
- 이미지 업로드와 상품 등록
- Kafka 이벤트 계약
- OpenSearch 색인과 검색

### 3주차

- 직접·자동 입찰
- Redis 원자 계산
- WebSocket 결과 전파
- 경매 종료와 핵심 장애 복구

### 4주차

- 실제 AWS 배포
- ALB Health Check와 EC2 Auto Scaling 검증
- CloudWatch 관측성
- 부하·장애·E2E 검증
- README, ADR, 결과와 회고

## 14. 사양 운영 규칙

1. 상위 Epic마다 `docs/specs/issue-NNN-<slug>.md`를 작성한다.
2. 문서에서 해당하는 S/D/B/I/T 영역을 구분한다.
3. `[DOC]` Sub-issue가 완료되기 전에 구현 Sub-issue를 시작하지 않는다.
4. 기술 선택에는 해결 문제, 대안, 선택 이유, 단점과 검증 방법을 기록한다.
5. 코드와 실제 동작이 사양을 바꾸면 문서를 같은 PR에서 갱신한다.
6. 테스트 결과와 장애 실험 결과는 `docs/reports`에 보관한다.

### 14.1 브랜치 이름

| 작업 종류 | Prefix | 예시 |
|---|---|---|
| 문서 | `docs/` | `docs/issue-22-project-scope` |
| 기능 | `feature/` | `feature/issue-35-cognito-login` |
| 버그 수정 | `fix/` | `fix/issue-48-duplicate-event` |
| 리팩터링 | `refactor/` | `refactor/issue-52-event-envelope` |

규칙은 다음과 같다.

- 브랜치 이름에 연결된 Sub-issue 번호를 포함한다.
- 설명은 영문 소문자 kebab-case로 작성한다.
- 기능 브랜치에 `feat/`를 사용하지 않고 `feature/`를 사용한다.
- 문서 사양과 기능 구현은 별도 브랜치와 PR로 분리한다.
- 긴급 수정도 `fix/` 규칙을 따른다.

## 15. 완료 정의

프로젝트는 다음 조건을 모두 충족할 때 완료한다.

- P0 Sub-issue가 모두 완료됐다.
- 모든 기능이 실패 테스트부터 시작하는 TDD 흐름으로 구현됐다.
- 필수 E2E 시나리오가 로컬과 AWS 검증 환경에서 통과한다.
- Kafka, Redis, OpenSearch 선택 근거가 측정 결과와 함께 기록됐다.
- 장애 복구 시나리오를 실행하고 결과를 문서화했다.
- Terraform Destroy와 잔존 비용 점검을 완료했다.
- README에서 문제, 구조, 실행 방법, 검증 결과와 한계를 확인할 수 있다.

## 16. 결정 사항

- EC2 장기 실행 Spring Boot와 Kafka 이벤트 기반 구조를 사용한다.
- 백엔드는 Java·Spring Boot 장기 실행 애플리케이션과 Port·Adapter 구조로 구성한다.
- 프론트엔드는 React.js·TypeScript·Vite를 사용한다.
- 핵심 도메인과 화면 상태는 TDD로 개발하고 순수 함수로 구성한다.
- Spring·RDB·메시징·브라우저 I/O는 얇은 Imperative Shell과 Adapter로 격리한다.
- Kafka 개발 환경은 로컬 Docker, AWS 검증 환경은 MSK Serverless를 사용한다.
- RDS PostgreSQL을 최종 원장으로 사용한다.
- Redis와 OpenSearch는 복구 가능한 파생 데이터로 취급한다.
- ALB가 HTTPS·Health Check·WebSocket과 분산을 담당하므로 Nginx는 사용하지 않는다.
- 실제 결제·배송·채팅은 한 달 MVP에서 제외한다.
- AWS 관리형 고비용 리소스는 상시 운영하지 않는다.
