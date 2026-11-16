# [Issue #96] 입찰 정산 Consumer 단독 중단·복구 사양

- 관련: [#96 장애 실험](https://github.com/dev-baek/bidflow/issues/96), [#19 부하·장애 검증](https://github.com/dev-baek/bidflow/issues/19)
- 선행: [실험 기준](./issue-019-load-failure-test.md), [Redis 실측](../reports/issue-096-redis-recovery.md), [OpenSearch 실측](../reports/issue-096-opensearch-recovery.md)

기존 두 실험은 Redis와 OpenSearch의 중단을 검증했다. 이번에는 Kafka와 Spring Boot HTTP API가 모두 살아 있는 상태에서 입찰 정산 Consumer만 멈춰 비동기 접수가 유지되는지 확인한다. 전체 애플리케이션을 종료하는 것은 이 결과를 대체할 수 없다.

## S. 사용자 관찰

- 단독 중단 중에도 새 입찰은 `202 RECEIVED`로 접수된다. 화면이나 공개 상세는 확정된 이전 현재가를 표시하며, 접수만으로 승인·현재가를 추정하지 않는다.
- Consumer를 재시작하면 기존 정산 경로를 통해 대기 요청이 최종 판정되고 공개 상세가 변경된다. 새 화면은 만들지 않는다.

## D. 원장·offset

- 시험용 경매 한 건과 서로 다른 입찰자·멱등 키만 사용한다. 중단 전에 현재가 12,000원을 확정한 뒤 13,000·14,000·15,000원 직접 입찰을 제출한다.
- 중단 중 새 요청 3건의 `bid_request`는 `RECEIVED`, 새 `BidCommandRequested` Outbox는 발행되며, 새 승인·거절 원장은 없다. 공개 현재가와 버전은 중단 전과 동일하다.
- 복구 후 요청마다 최종 판정과 원장 1건, 최종 현재가 15,000원과 승인 원장의 최고 입찰자 일치를 검증한다. 여러 승인 결과가 생긴다면 저장 순서에서 가격이 역행하지 않아야 한다. 같은 본인·본문·키를 재시도해도 접수가 추가되거나 새 원장이 생기지 않는다.
- 스키마, 메시지 계약, 파티션 Key와 Consumer Group ID는 바꾸지 않는다.

## B. 로컬 Listener 제어

- 기존 `bid-settlement` Listener에 명시적 컨테이너 ID를 지정한다. [Spring Kafka Listener 생명주기](https://docs.spring.io/spring-kafka/reference/kafka/receiving-messages/kafkalistener-lifecycle.html)의 Registry에서 **해당 컨테이너만** 찾아 중단·재시작한다. Registry 전체, 다른 Listener, Kafka broker, Outbox Scheduler, HTTP 서버는 제어하지 않는다.
- 테스트 제어 경로는 `POST /api/internal/e2e/bid-settlement/stop`과 `POST /api/internal/e2e/bid-settlement/start`로 한정한다. 요청에 임의 Listener 이름, 그룹 ID, offset 또는 명령을 받지 않는다.
- 중단 호출에 성공해도 Kafka 그룹의 활성 멤버가 0이 되고 직전 처리·커밋이 끝났음을 관측한 뒤에만 새 시험 입찰을 보낸다. 재시작 성공 응답 역시 정산 완료를 뜻하지 않는다. readiness·그룹·DB를 따로 확인한다.

## I. 실험 안전장치

- 로컬 전용이다. `local`과 `e2e` 프로필이 모두 활성화되고 기본값이 꺼진 전용 설정(예: `bidflow.e2e.bid-settlement-control-enabled=true`)을 켰을 때만 경로를 등록한다. 서버는 루프백 주소에 바인딩하고 요청이 루프백에서 직접 온 경우만 허용한다. 프록시 전달 헤더를 루프백 인증 근거로 쓰지 않는다.
- 기존 인증 경계를 그대로 적용한다. 로컬 개발 ID는 테스트 식별자이고 운영 자격증명이 아니다. 운영/AWS 환경에 제어 경로를 배포하거나 외부에 노출하지 않는다.
- 실험 전에 `bid-settlement` 활성 멤버가 하나인지 확인한다. 실패·시간 초과에도 중단된 Listener는 먼저 재시작한다. offset을 초기화하거나 Redis·Kafka·DB·볼륨·DLT를 삭제하지 않는다.

## T. RED → GREEN 및 실제 관측

1. 일반 `local` 또는 `e2e` 단독, 플래그 꺼짐에서 경로 미등록을 확인한다. 활성 조합에서도 익명과 외부 요청을 거부하고 Registry 전체 또는 다른 Listener를 호출하지 않는지 검증한다.
2. 실제 로컬에서 Listener 중단 전·중·후 `bid-settlement` 그룹의 멤버, 파티션별 커밋 offset과 end offset을 기록한다. 중단 상태에서 입찰 3건 모두 `202`, Outbox 발행, 미처리 3건 및 해당 파티션 Lag 증가를 확인한다.
3. 같은 그룹을 재시작하고 60초 내 Lag 0과 3건의 최종 원장을 확인한다. 표본에서 관찰한 최초 Lag 0과 정확한 회복 시간은 구분한다. 정상 복구 시 시험 명령의 DLT 증가가 없어야 한다.
4. 같은 입찰 키를 재전송해 같은 요청 ID와 단일 원장을 확인하고, API readiness 및 대상 외 Listener가 실험 때문에 중단되지 않았음을 기록한다.

이 사양 병합 후 실패 테스트부터 구현한다. 이번 문서는 Consumer 장애를 실제로 실행했다는 증적이 아니다.
