# 로컬 입찰 E2E 실패 증적 연결 사양

- 상태: #299 병합으로 승인됨. 직접 입찰의 TDD 구현과 정상 5개/고의 실패 1개 실행·복원·재조회를 완료했다. [구현·실행 결과](../reports/issue-020-failure-correlation.md). 아래는 승인된 계약이다.
- 기존 이슈: [#20](https://github.com/dev-baek/bidflow/issues/20). 기존 [E2E 실패 증적 계약](issue-020-e2e.md)의 후속이므로 새 이슈를 만들지 않는다.
- 선행 결과: [#298 합성 캡처](../reports/issue-020-failure-artifacts.md)는 screenshot/trace/console 보존만 확인했다. 이번 범위는 실제 로컬 입찰 경로의 접수·메시지·DB 식별자를 연결하는 것이다.

## S. 첫 적용 사례와 성공의 의미

기존 Playwright의 **직접 입찰 재시도/후속 입찰 사례 한 개**에 실패 진단을 연결한다. 기존 A 12,000원 → 같은 요청 100회 재전송 → 다른 금액 409 → B 13,000원 → A 새 요청 14,000원의 단언·금액·키 정책을 바꾸지 않는다. 모든 기능/성능 테스트에 적용하는 관측 프레임워크는 만들지 않는다.

실패하면 이번 시험 경매와 요청의 HTTP·공개/개인 메시지·원장/결과를 연결한 JSON을 Playwright attachment로 남긴다. 가능한 화면은 소유 context를 닫기 전에 보존하고 기존 자동 screenshot/trace도 유지한다. 직접 생성한 역할별 화면과 Playwright 자동 캡처를 구분한다.

업무 테스트의 실패와 증적 수집 성공은 별개다. 진단을 완성해도 원래 실패/종료 코드를 성공으로 바꾸지 않는다. 브라우저 종료·SQL 장애 등으로 누락되면 partial/incomplete로 남기고 원래 오류를 보존한다. 기존 정상 실행에 고의 실패를 기본으로 켜지 않는다.

## D. 시험 범위와 식별자

테스트별 새 runId와 생성된 경매 UUID를 메모리 registry로 연결한다. DB에 run_id 열이 있다고 가정하거나 스키마를 추가하지 않는다. 등록 성공으로 확인한 이번 경매에만 조회를 허용하고, 실패가 등록 전이면 SQL 미수집으로 남긴다. 외부/기존 경매를 자동 발견하거나 전체 DB를 조회하지 않는다.

증적에는 다음 허용 필드만 포함한다.

| 경계 | 허용 필드 |
|---|---|
| 실행 | source SHA, runId, 고정 사례 ID, 단계, 상대 시각, 원래 상태/진단 상태와 고정 오류 코드 |
| HTTP | 역할 alias, 이번 경매 ID, 메서드/고정 경로 종류, 상태 코드, 검증한 멱등 키·요청 ID·접수 상태·고정 오류 코드 |
| WebSocket | 공개/개인 채널 종류·관찰 역할, 도메인 eventId, auctionId/bidRequestId, type, version, 판정/고정 사유, 공개 가격·마감, 상대 수신 시각 |
| SQL | 해당 경매의 상태/version/현재가·마감, 요청/원장/결과 ID·수·판정·금액·version, 시험 actor의 alias |
| 캡처 | 역할별 생성/누락 상태·고정 실패 사유, artifact 종류·크기·hash, 제한 초과·수집 누락 여부 |

raw URL/query·Authorization/Cookie·presigned URL·헤더 전체·HTTP body·원문 frame·임의 console/예외/SQL 출력은 JSON에 복사하지 않는다. Console은 수준/개수·허용된 고정 표식만 요약하고, 원문이 담길 수 있는 trace는 보호된 로컬 artifact로만 둔다. raw artifact를 자동 커밋/업로드하지 않는다.

UUID·등록된 역할/채널·유효 시각을 검증하고 미지 필드는 제거한다. 숫자가 존재하면 가격은 음수가 아닌 안전 정수, version은 양의 안전 정수여야 한다. null/누락/잘못된 값은 구분하며 0이나 가짜 ID로 채우지 않는다. 기존 앱 parser를 호출했다는 사실만으로 진단 입력 전체를 신뢰하지 않는다.

## B. 연결 규칙과 최소 구현

기존 E2E helper/입찰 결과 parser와 `scripts/concurrent-browser-sql.mjs`의 경매 한정 SQL을 재사용한다. 프로토콜/서버 payload/DB 변경은 없다. 순수 함수가 허용 필드 추출·중복/충돌·연결·완전성을 판정하고, 얇은 경계가 page/HTTP 이벤트·SQL·attachment를 처리한다. 새 의존성이나 운영 텔레메트리 기능은 추가하지 않는다.

- Browser POST뿐 아니라 기존 `APIRequestContext` 재전송/409 응답도 등록된 시험 경매 범위에서 기록한다. 재전송 100회를 새 입찰 100개로 세지 않는다. 정상 마지막 상태는 서로 다른 요청/원장/입찰 결과 각각 3개와 14,000원이다.
- 서버 `BidRealtimeKafkaListener`가 이미 넣는 payload eventId를 진단 경계에서 UUID로 검증한다. 현재 프런트 타입에 없다는 이유로 가짜 값을 채우거나 STOMP message-id를 도메인 ID로 쓰지 않는다. 앱의 공개/개인 타입 확장은 이번 목적에 필요하지 않다.
- SQL의 결과 eventId/requestId와 개인 결과의 eventId/bidRequestId를 대조한다. 공개 메시지는 같은 경매·domain eventId·version으로 연결한다. 같은 이벤트의 공개/개인 전달이나 재전송은 원장 중복으로 세지 않고, 충돌 payload/다른 경매·요청·역할은 별도로 구분한다.
- 메시지 version/가격은 최신 snapshot일 수 있다. [기존 정산/snapshot 구분](issue-019-concurrent-snapshot-alignment.md)처럼 요청별 정산 version과 분리하고, 수집한 승인 체인의 유효 version/가격 쌍인지 확인한다. 무조건 동일 version을 요구하거나 다른 request의 최신 값을 해당 요청의 정산 결과로 바꾸지 않는다.
- SQL은 수집 시점의 사후 관측이다. 모든 HTTP 시점/원래 실패 순간의 상태나 정확한 커밋 시간으로 해석하지 않는다. 필요한 frame/ID가 없으면 연결 완전성을 통과시키지 않는다.

수집기는 원래 단언 오류를 다시 던지기 전에 가능한 증적을 best-effort로 남기고 cleanup에서 listener를 해제한다. 각 소유 역할의 페이지가 닫혔거나 SQL 조회가 실패해도 전체 진단을 무한히 기다리지 않는다. HTTP 최대 256건·WS 64건·console 요약 64건을 보존하며 초과 사실을 표시한다. 잘린 결과를 complete로 세지 않는다. SQL statement timeout 4초/프로세스 5초와 전체 실패 수집 예산 10초를 넘기지 않고, 늦게 끝난 I/O가 반환/저장된 증적을 변경하지 않게 한다. 원래 기능 assertion timeout을 완화해 테스트를 통과시키지 않는다.

## I. 로컬 전용과 실제 실행 횟수

증적 출력은 저장소 밖 새 보호된 디렉터리에 둔다. source SHA·도구·소유 API PID/인자/jar·프로필/Clock·로컬 서비스 상태를 먼저 확인한다. web/API는 명시적 loopback 주소만 허용하며 실제 Cognito/AWS/원격 주소로 진단을 실행하지 않는다.

필요한 local,e2e 검증 API·임시 Vite 전환은 기존 소유 프로세스 확인/완전 종료/복원 절차를 따른다. 성공/실패와 관계없이 원래 API의 인자/jar/listen PID/readiness와 임시 프로세스 종료를 확인한다. OS 시계·공유 데이터/볼륨/Redis key/Kafka offset은 초기화하지 않는다. 새 시험 데이터는 보존하며 다른 개발 컨테이너는 중단하지 않는다.

구현 검증은 다음 두 번으로 제한한다.

1. 기존 기능 5개를 worker 1/retry 0·검색 활성화로 한 번 회귀 실행한다. 하나라도 실패/skip이면 고의 실패 probe를 시작하지 않는다.
2. 통과하면 새 경매에서 직접 입찰 사례만 한 번 실행한다. 별도의 명시적 로컬 진단 실행에서 마지막 14,000원/새 요청 단언까지 통과한 뒤 고정 `BIDFLOW_EXPECTED_CORRELATION_FAILURE`를 발생시킨다. 임의 위치/서비스 장애 주입 옵션은 만들지 않는다. 정확한 의도 오류/종료 1·실패 1·skip/retry 0과 연결 JSON·캡처를 함께 검증한다.

probe는 정상 E2E 기본 실행에서 꺼져 있어야 하며 다른 사례·원격 환경·parallel/retry 조건이면 실행을 거부한다. 실패를 자동 재시도하거나 원래 단언 실패를 의도한 probe 실패로 인정하지 않는다. 이 결과는 진단 경로 검증이지 실제 운영 장애의 원인 분석이나 새로운 부하 실측이 아니다.

## T. TDD와 완료 조건

1. 순수 추출/판정 테스트를 먼저 RED로 만든다. 정상·중복/재전송·409·외부 ID/역할·충돌·누락·잘림·시각/가격/version 오류와 민감한 미지 필드 제거를 검증한다.
2. 가짜 I/O로 등록 전 실패·SQL 실패/timeout·화면 닫힘·쓰기/attachment/cleanup 실패·늦은 완료를 검사한다. 수집 실패가 원래 단언을 덮거나 실패를 성공으로 만들면 안 된다.
3. 실제 이벤트 형식의 도메인 ID와 snapshot/정산 경계를 검사한다. 파일 존재나 문자열 구성 검사만으로 연결 성공을 대신하지 않는다.
4. `make verify`/기본 CI에서 Docker·브라우저·AWS 없이 수집/판정 회귀를 실행한다. 실제 브라우저 두 실행은 위 로컬 범위로만 수행한다.
5. 새 증적 PR에 원래 테스트 결과와 진단 상태·연결된 3개 요청/원장/결과·캡처/누락·상태 복원을 나눠 보고한다. #298 합성 결과는 그대로 보존하고 #20을 AWS 완료로 닫지 않는다.
