# 동시 입찰 브라우저 수집과 SQL 대조 구현

기존 [#19](https://github.com/dev-baek/bidflow/issues/19)의 [승인 사양](../specs/issue-019-concurrent-browser-latency.md)에 따라 [순수 판정](issue-019-concurrent-observer-implementation.md)을 브라우저 수집과 SQL 확인에 연결했다. 이번 검증은 가짜 I/O·회귀 테스트·테스트 로딩과 SQL 실행 계획 확인까지다. 실제 두 사용자 입찰 smoke와 10회 실측은 별도 단계다.

## 수집 경계

`scripts/collect-concurrent-browser.mjs`는 현재 시각, 구독, 제출, 화면 관측 함수를 주입받는다. 리스너를 먼저 등록한 뒤 두 제출을 시작하고, 각 click 직전과 실제 POST 관측 시각을 따로 기록한다. HTTP 응답보다 개인 frame이 먼저 도착해도 요청 ID로 연결할 수 있다.

기본 10초의 전체 관측 deadline을 사용하며 최초 실패 뒤 성공을 합성하지 않는다. 실패·timeout에서도 부분 접수/이벤트와 고정 오류 코드를 반환하고 AbortSignal과 리스너 정리를 실행한다. 종료 뒤 늦게 완료된 HTTP나 frame이 반환 증적을 바꾸지 못하도록 막았다. 반복 POST, 정리 실패, 잘못된 접수/시각/화면은 실패다. 원본 예외·Token·전체 frame을 증적에 복사하지 않는다.

## 읽기 전용 SQL

`scripts/concurrent-browser-sql.mjs`는 유효한 경매 UUID와 서로 다른 요청 UUID 2개만 받는다. Docker의 고정된 `bidflow-local-postgres-1`에서 psql을 실행하며 원격 주소를 입력받지 않는다. `BEGIN READ ONLY`와 4초 statement timeout 안의 한 SELECT로 같은 snapshot의 요청·원장·결과 Outbox·경매를 읽는다. 프로세스 timeout은 5초다. 데이터 생성·수정·삭제 명령은 없다.

순수 `judgeConcurrentSql`은 다음을 모두 대조한다.

- 경매의 요청·원장·결과 이벤트 총계가 각각 2건이고 각 요청에는 원장과 결과가 정확히 1건인지
- 사용자, 요청/경매 ID, 금액, 판정, 거절 사유, 이벤트 종류와 version이 브라우저 관측과 맞는지
- 승인 이벤트 version이 2부터 연속 증가하고 가격이 증가하는지
- 최종 ACTIVE 경매의 version이 승인 건수 +1이며 가격 12,000원·승자 B·원래 종료 시각과 일치하는지

거절 원장의 current_price와 거절 Outbox의 currentPrice는 null인 현재 저장 계약을 따른다. 이를 개인 frame의 공개 현재가 12,000원과 같아야 한다고 요구하지 않는다. 원장에 없는 version 컬럼이나 decided_at 동률로 순서를 추정하지 않는다.

## Playwright 연결

기존 listing-registration.spec.ts에 명시적 플래그의 관측 테스트를 추가했다. 두 사용자 context만 열어 회차마다 새 경매에 11,000원/12,000원을 함께 제출하고, 정상 승인/거절 안내와 양쪽 공개 12,000원을 확인한다. worker 1, retry 0과 고정된 loopback Vite/API 주소를 요구한다. 서로 다른 멱등 키도 확인한다.

현재 7개 테스트 중 기존 6개의 제목과 시나리오는 유지한다. 테스트의 입찰자 준비 helper에는 실패 시 생성한 context를 닫는 정리를 보완했다. 기본 make verify는 브라우저나 Docker를 시작하지 않는다.

증적에는 회차별 수집 입력, SQL 판정, 생성된 경매 ID, 진행 단계와 완료/미완료를 남긴다. 원본 SQL 응답은 첨부하지 않는다. 순수 집계의 브라우저 observationValid와 SQL 확인을 별도로 결합하며, 모든 정상 10회가 완료돼야 전체 valid가 될 수 있다. P95 2초 판정은 따로 보존한다.

## TDD와 검증 결과

새 실패 테스트를 먼저 실행해 수집 모듈 부재의 ERR_MODULE_NOT_FOUND를 확인했다. 이후 수집과 SQL의 가짜 I/O 테스트 7개를 통과시켰다. 응답 전 frame, HTTP 실패/미완료, 늦은 HTTP/화면, 구독/정리 실패, 반복·누락 POST, 개인정보 필드 제거, SQL의 요청/원장/이벤트/승자 불일치와 위험한 UUID 입력을 검증한다.

전체 Node 스크립트 테스트는 54개 성공, 실패·skip 0개다. make verify에서도 Vitest 68개와 양쪽 build가 성공했으며, 이번 로컬 백엔드 unitTest와 bootJar는 기존 결과를 UP-TO-DATE로 재사용했다. make verify 실행 이후 추가한 수집 경계 테스트도 전체 Node suite로 다시 확인했다.

Playwright --list는 새 테스트를 포함한 7개를 정상 로딩했다. 별도 TypeScript 검사에서는 프로젝트에 Node 타입 패키지가 없어 처음 중단됐고, 임시 디렉터리에만 @types/node를 준비한 뒤 새 callback의 암시적 any 문제를 확인했다. 수집 함수의 JSDoc 계약과 화면 판정 guard를 추가해 별도 타입 검사도 통과했다. 저장소의 package.json/lock과 런타임 의존성은 바꾸지 않았다.

실제 로컬 PostgreSQL에는 무작위 UUID로 범위를 좁힌 읽기 전용 EXPLAIN만 수행해 문법과 실행 계획을 확인했다. EXPLAIN ANALYZE나 입찰 데이터 삽입은 하지 않았다. 실행 계획 확인을 실제 20건 정합성 검증으로 취급하지 않는다.

## 실행과 남은 실측

Java 21·Node 24와 [기존 local,e2e 실행 절차](issue-099-playwright-e2e.md)를 사용한다. 실제 API의 Outbox 간격이 100ms인지 확인하고 기존 서버를 교체할 경우 원래 프로필·인자와 상태를 기록해 복원해야 한다. 다른 Clock 변경/부하와 동시에 실행하지 않는다.

apps/web에서 다음 환경변수와 명령으로 **별도 새 Fixture**의 smoke와 본 실행을 구분한다.

```sh
export BIDFLOW_E2E_BASE_URL=http://127.0.0.1:5173
export BIDFLOW_E2E_API_BASE_URL=http://127.0.0.1:8080
export BIDFLOW_E2E_CONCURRENT_LATENCY=1

# 한 회차 smoke. 전체 valid/P95 달성으로 표시하지 않음
BIDFLOW_E2E_CONCURRENT_SMOKE=1 npm run test:e2e -- --workers=1 --grep '동시 두 사용자 입찰'

# 새 10회/20건 본 실행. smoke 표본과 합치지 않음
BIDFLOW_E2E_CONCURRENT_SMOKE=0 npm run test:e2e -- --workers=1 --grep '동시 두 사용자 입찰'
```

성공/실패 모두 Playwright output의 concurrent-browser-latency.json에 첨부한다. 준비 환경·실제 프로필/간격·도구 버전·Kafka Lag 전후와 호스트 환경은 후속 실측 보고서에 함께 남겨야 한다. 자동 retry나 기존 데이터·Redis 키·볼륨 삭제는 하지 않는다.

AWS, 기존 실행 서버의 재시작, 실제 smoke/정식 입찰, 부하 및 전체 backend integration check는 이번에 실행하지 않았다. 원본 작업 폴더의 미추적 복제 파일과 루트 package-lock.json도 보존했다. 기존 npm 취약점 경고의 수정은 이번 범위가 아니며 #19는 열린 상태로 유지한다.
