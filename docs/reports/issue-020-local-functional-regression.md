# 로컬 기능 E2E 회귀 검증 결과

기존 [#20 E2E 사양](../specs/issue-020-e2e.md)과 [#99 실행 절차](issue-099-playwright-e2e.md)의 기능 시나리오 5개를 #292 병합 main에서 한 번 실행했다. **5개 모두 통과했고 실패·skip·flaky·재시도는 0개였다.** 테스트 뒤 원래 API를 복원했으며 새 시험 경매 8개에 대한 읽기 전용 SQL 교차 검사도 통과했다. 앱과 테스트 코드는 변경하지 않았다.

## 실행 환경과 선택한 사례

- 소스: `2537abf182f006e20e3c4e4d0eccc33637c3bd45`.
- 실행/복원: 2026년 11월 22일 02:59:51–03:00:53 UTC (일본 시각 11:59:51–12:00:53).
- Node 24.18.0, Java 21.0.7, Mac15,12/arm64/8 CPU/16 GiB, Docker 27.5.1. PostgreSQL·Kafka·Redis·SeaweedFS·OpenSearch는 실행 전후 healthy였다.
- local,e2e의 테스트용 인증·Clock, Outbox 100ms/INFO와 임시 Vite를 사용했다. worker 1, retries 0이며 UUID가 다른 새 경매를 만들었다. 기존 데이터/볼륨/Redis key/Kafka offset을 초기화하지 않았다.
- 검색은 `BIDFLOW_E2E_SEARCH=1`로 활성화했다. 순차/동시 지연 측정 2개는 grep 선택에서 제외했으며 기능 사례를 skip 처리한 것이 아니다.

| 기존 시나리오 | 이번 확인 범위 | 결과 |
|---|---|---|
| 등록과 유찰 | 이미지 업로드·상품/경매 등록, 입찰 없는 경매의 공개 ENDED/UNSOLD와 입찰 폼 제거 | 통과 |
| 자동 입찰과 종료 | A/B 최대가 30,000/20,000원 → 공개가 21,000원, 최대가 비공개, 마감 +5분, 원래 마감 대조, 연장 마감 낙찰, 종료 후 거절, 개인 낙찰/패찰/비참여·재로그인 | 통과 |
| 직접 입찰과 재시도 | 같은 키/금액 100회 재전송의 요청 ID 유지, 다른 금액 409, 상대 추월 후 새 키/요청으로 후속 입찰, 과거 승인 안내 유지 | 통과 |
| WebSocket 재연결 | 연결이 끊긴 동안 놓친 가격을 재연결 뒤 REST에서 읽고 새로고침 없이 반영 | 통과 |
| 검색과 상세 이동 | 세 상품 색인, 복합 필터/가격순 정렬, 검색 결과에서 올바른 경매 이동, 뒤로가기·새로고침 후 URL 조건 복원 | 통과 |

이 표는 기존 테스트 단언의 실행 결과다. Cognito 로그인이나 실제 배포 환경을 검증한 것이 아니고, 과거 version 이벤트의 인위적 주입이나 장애/성능 실험을 새로 추가하지 않았다.

## SQL과 원장 교차 검사

실행 전후 경매 UUID 집합의 차이로 새 경매 8개를 식별했다. API 복원 후 그 ID에만 범위를 둔 read-only transaction과 statement timeout으로 조회했다. 기존 공유 SQL의 요청/원장/결과 조인을 재사용했다. [구조화 증적](evidence/issue-020-local-functional-regression.json)에 경매 ID, 개별 요청·원장·이벤트와 조회 시각을 보존했다.

- 요청 8개, 원장 8개, 입찰 결과 이벤트 8개. 승인 7개, 종료 후 AUCTION_ENDED 거절 1개, 미처리 0개.
- 요청별 원장·결과는 하나이며 요청/원장/결과 ID 중복은 각각 0개다. actor·금액·판정·요청 ID·경매 ID·원장/이벤트 가격과 사유를 대조했다.
- 경매 결과와 AuctionEnded는 각각 3개다. 공개 유찰 1개와 낙찰 12,000원·21,000원 각 1개이며 승자/최종가는 경매 상태와 일치했다. 종료 이벤트는 경매별 하나였고, 해당 경매 이벤트에 연결된 consumer_name/event_id 중복은 0개다.
- 정산 그룹 세 partition의 Lag는 실행 전후 모두 0이다. 중간 피크나 정확한 처리/회복 지연을 측정한 값은 아니다.

SQL은 사후 상태의 교차 검사이며 브라우저 단언 순간의 DB 스냅샷이나 별도 동시성/성능 실험으로 해석하지 않는다. 종료 후 입찰을 202로 접수해도 최종 승인하지 않는다는 계약을 확인했다.

## 복원과 검증

소유 API PID 24969의 local/명시적 1,000ms/INFO 인자·jar를 확인하고 완전 종료한 뒤 검증 JVM PID 30721을 실행했다. 종료 후 검증 JVM과 Vite의 완전 종료를 확인하고 원래 jar/인자로 PID 30982를 복원했다. jar SHA-256 `5251be8d60c6fc0f3a7afb13415c72e2438713b973a854a54f411009065f08c4`, 실행 인자·listen PID 일치와 readiness UP을 확인했다. 다른 개발 컨테이너는 유지했고 OS 시계는 변경하지 않았다.

실행 전 make verify가 통과했다. Node 92개·Vitest 17파일/71개와 TypeScript/Vite build를 확인했으며 백엔드 unitTest/bootJar는 UP-TO-DATE였다. 새 앱 로직이 없으므로 새로운 TDD 구현은 하지 않았다.

실패 trace/screenshot은 기존 retain-on-failure/only-on-failure 설정을 유지한다. 이번에 실패가 없어 생성된 실패 파일은 없으며, 실패를 고의로 주입해 증적 생성을 재검증한 것은 아니다. 원문 reporter·서버 로그·trace·HTTP 본문·환경·토큰은 커밋하지 않고 허용 필드와 원본 파일 hash만 기록했다.

## 남은 승인 범위

#20의 로컬 기능 5개와 SQL 교차 검사는 완료했다. [#91 AWS 사용자 여정·Destroy](https://github.com/dev-baek/bidflow/issues/91)는 별도 승인 전 미실행이며, 테스트 인증/Clock을 AWS 검증에 재사용하지 않는다. 전체 backend integration check나 새 부하/지연 측정도 이번 범위가 아니다. AWS 완료 조건이 남아 있으므로 #20은 닫지 않는다.
