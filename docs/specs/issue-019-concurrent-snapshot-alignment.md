# 동시 입찰 관측의 개인 판정과 최신 snapshot 구분

- 상태: 제안됨. 문서 승인 전에는 판정 코드나 서버 동작을 바꾸지 않는다.
- 기존 이슈: [#19](https://github.com/dev-baek/bidflow/issues/19).
- 선행: [동시 관측 사양](issue-019-concurrent-browser-latency.md), [실패 smoke와 진단](../reports/issue-019-concurrent-smoke-failure.md), [기존 WebSocket 계약](issue-014-realtime-websocket.md)의 D/I.

## 수정 이유와 결정 제안

첫 실제 smoke에서 두 입찰 모두 승인됐지만 관측기는 INVALID_RESULT로 실패했다. 개인 bid.result의 decision은 요청별 결과이고 currentPrice·auctionVersion은 Projection이 읽은 최신 DB snapshot이다. 기존 관측기는 이 두 시점이 항상 같다고 가정해 A의 11,000원 승인에도 snapshot 가격이 11,000원이어야 한다고 요구했다.

기존 WebSocket 계약은 과거 이벤트를 소비할 때 더 최신 snapshot을 보낼 수 있도록 정의한다. **서버 메시지를 과거 상태로 바꾸지 않고, 관측 판정에서 요청별 정산 사실과 최신 snapshot을 분리**하는 방향을 제안한다. P95 2초, 총 10회/20건, 동시성 조건, 기존 실패 보존은 그대로다.

## S. 화면 완료 기준

기존과 같이 양쪽 공개 12,000원과 각자의 승인/거절 안내를 확인한다. 낮은 입찰의 과거 11,000원 화면을 꼭 관측해야 한다고 요구하지 않는다. 개인 frame의 requestId·auctionId·채널·판정·사유는 해당 요청과 일치해야 한다.

isHighestBidder는 이번 실험의 최종 승자 근거로 사용하지 않는다. 현재 구현은 이 값을 이벤트에서 가져오지만 가격·버전은 최신 snapshot에서 가져온다. 따라서 A의 승인 당시 true가 B의 최종 승리 뒤에도 남을 수 있다. 이 시점 차이와 화면의 “현재 최고 입찰자” 문구 위험을 관측 판정 수정만으로 해결했다고 주장하지 않는다. 해당 UI/메시지 의미 변경은 이 제안의 범위가 아니다.

## D. 서로 다른 두 사실의 검증

요청별 정산은 PostgreSQL 요청·원장·결과 Outbox로 확인한다. 기존 ID·사용자·금액·판정·사유와 요청당 원장/결과 1건 규칙을 유지한다. 원장/결과의 version과 가격을 개인 frame의 최신 snapshot과 무조건 같다고 비교하지 않는다.

새 경매 초기 version 1·시작가 10,000원인 제한된 시나리오에서 다음 조합만 허용한다.

| 판정 | 요청별 결과 Outbox | A 개인 frame의 snapshot | B 개인 frame의 snapshot |
|---|---|---|---|
| A/B 모두 승인 | A 11,000원·v2, B 12,000원·v3 | 11,000원·v2 또는 12,000원·v3 | 12,000원·v3 |
| B 승인 뒤 A 거절 | B 12,000원·v2, A BID_TOO_LOW·v2 | 12,000원·v2 | 12,000원·v2 |

가격과 version은 **같은 snapshot의 쌍**으로 검증한다. 예를 들어 모두 승인된 회차에서 12,000원·v2, 11,000원·v3, 존재하지 않는 v4를 허용하지 않는다. 단순히 frame.version이 event.version 이상이면 통과시키지 않는다. SQL에서 확인한 승인 이벤트 체인의 실제 가격/version과 연결하고 최종 경매의 version을 넘을 수 없다.

승인 이벤트 version은 연속 증가해야 하며 가격도 증가해야 한다. 최종 ACTIVE 경매는 B·12,000원·초기 version + 승인 건수이며 종료 시각도 그대로여야 한다. 거절 원장/Outbox의 null 가격과 frame의 공개 현재가는 계속 구분한다.

## B. 최소 수정 범위

동시 관측 전용 순수 판정과 SQL 판정에서 정산 version과 snapshot version을 분리한다. 반환 표본에서 snapshot이라는 의미를 명확히 하고, SQL 정산 version을 frame 값으로 덮어쓰지 않는다. 기존 frame 파서·collector·서버 API·메시지 schema·DB migration은 변경하지 않는다.

순차 측정 전용 matchesObservedBid 계약은 유지한다. 정상 업무 거절·요청 연결·개인 채널 누출·충돌하는 중복 결과·시각/timeout 검증을 약화하지 않는다. 기존 실패 JSON과 판정은 보존하며 새 기준으로 다시 통과 처리하지 않는다.

## I. 승인 후 실행

회귀 테스트와 수정 판정을 확인한 뒤 별도의 새 Fixture로 smoke부터 실행한다. 이 smoke가 성공해야 정식 10회를 실행한다. 기존 실패 경매는 재사용하거나 삭제하지 않는다. local,e2e/100ms·worker 1/retry 0·기존 종료와 복원 절차를 유지한다. AWS·볼륨/offset reset은 없다.

## T. 실패 테스트와 완료 기준

1. 새 테스트에서 A의 정산 11,000원·v2와 개인 snapshot 12,000원·v3 조합을 현재 코드가 거부하는 RED를 확인한다.
2. 본인 snapshot과 더 최신 유효 snapshot을 모두 검증하되 표에 없는 가격/version 쌍·과거/미래 version·다른 요청/채널·잘못된 판정은 실패해야 한다.
3. SQL 정산 값과 snapshot을 구분해 검증한다. 원장/이벤트의 version·가격 변조, 최종 승자/버전 불일치, 원장·결과 중복은 계속 실패해야 한다.
4. 기존 순차 관측·중복/누출/timeout·수집기 테스트를 포함한 전체 Node 회귀와 공통 CI가 통과해야 한다.
5. 새 smoke와 정식 회차는 이전 실패와 분리해 결과를 보존한다. 정상 20건 및 SQL 대조 전에 동시 입찰 P95 목표 달성을 선언하지 않는다.
