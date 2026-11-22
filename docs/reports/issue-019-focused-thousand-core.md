# 단일 경매 천 건 부하의 요청 계획과 정합성 판정 구현

[#286에서 승인한 사양](../specs/issue-019-focused-thousand-requests.md)의 첫 단계로 요청 계획·순수 판정·k6 시나리오·읽기 전용 SQL을 구현했다. 기존 #19를 이어가는 작업이며, **실제 1,000건 부하를 실행하거나 통과한 결과는 아니다.** 수집·중단·복원 경계가 연결되기 전에는 새 시나리오를 실측 완료로 사용하지 않는다.

## 구현 범위

scripts/focused-thousand.mjs의 planFocused는 full의 20 VU × 50회와 smoke의 2 VU × 5회를 구분한다. 각 요청은 순번·멱등 키·합성 actor·금액을 순수하게 생성한다. 정식 요청 1,000개의 네 필드가 각각 유일하고 금액 범위가 60,000~50,010,000원인지 테스트한다. runId·VU·iteration·mode를 검증하며 원격 주소나 경로·인증정보를 포함한 URL은 허용하지 않는다.

judgeFocused는 HTTP 접수 기록의 요청 ID/키/금액/actor 집합과 SQL의 요청·원장·결과 이벤트를 모두 대조한다. 승인 이벤트 version 순서의 가격 상승·연속 version과 최종 경매의 가격·승자·version·마감 불변을 검사한다. 거절은 BID_TOO_LOW만 허용하며 요청 금액과 null인 정산 가격을 구분한다. 여러 요청의 집계 건수만 일치하거나 최신 snapshot 값을 정산 가격처럼 사용하면 통과하지 않는다.

judgeResources는 별도의 순수 자원 판정이다. 약 1초 표본에서 연속 5개의 90% 이상 CPU, 심각한 메모리 압박, OOM, 누락/역전/잘못된 자원 값을 거부한다. 이 두 함수의 valid는 **각 판정의 결과**다. DLT·Kafka Lag·성능 기준·복원·실제 수집의 성공을 포함한 전체 실행 판정은 아니다.

tests/load/bid-request.js에는 focused-thousand만 추가했다. 120초 상한·gracefulStop 0·요청 timeout 5초·redirect 0·요청 뒤 100ms 대기를 적용한다. 응답에서는 requestId와 RECEIVED만 추출하고, 허용한 접수 필드만 JSON 로그로 남긴다. 알 수 없는 HTTP 응답 필드는 로그에 복사하지 않는다. summary 출력은 향후 수집기가 새로 mount할 /results/summary.json을 사용한다.

기존 focused의 20회 고정 금액과 distributed의 2분 유지/1초 페이싱·임계값은 유지했다. 기존 shell runner와 Make target을 새 실험용 runner로 가장하지 않으며, 아직 새 실행 명령을 공개하지 않는다.

## SQL 재사용과 경계

기존 두 사용자 SQL의 공통 SELECT를 내부 scopedBidSql로 분리했다. buildConcurrentSql은 두 요청 ID 검증과 기존 필터를 유지하고, 새 buildFocusedSql은 유효 UUID인 해당 경매의 요청 전체를 조회한다. 요청 키 필드를 추가했지만 브라우저 판정 계약은 바꾸지 않았다.

두 경로 모두 BEGIN READ ONLY와 statement_timeout 4초를 유지한다. 실제 로컬 PostgreSQL에서 기존 시험 경매 1개를 읽어 요청 20행·키 존재·JSON 파싱을 확인했다. 이는 SQL 문법과 연결 점검이며 새 부하 실행이나 1,000행 성능 검증이 아니다. 행 삽입·갱신·삭제는 하지 않았다.

## TDD와 검증

- 요청 계획/판정 테스트를 먼저 작성했다. 최소 미구현 반환값 상태에서 7개 중 5개가 실패해 계획의 1,000건 생성·입력 거부·정상 승인/거절과 자원 판정 부재를 확인했다. 최소 구현 뒤 통과했다.
- k6 연결 테스트는 새 시나리오가 거부되어 실패했다. 시나리오 추가 후 fake HTTP/metrics 환경에서 설정·단일 전송·본문 제한과 기존 두 시나리오가 통과했다.
- SQL 테스트는 새 export가 없어 실패한 뒤 구현했다. 기존 두 사용자 수집/SQL 테스트 8개도 함께 통과했다.
- null 입력과 자원 표본에서 예외가 발생하는 실패를 추가로 확인한 뒤 실패 판정을 반환하도록 수정했다. 순수 함수의 입력 불변도 확인했다.
- 신규 Node 테스트는 12개다. 전체 make verify의 Vitest 17파일/71개·Node 69개와 TypeScript/Vite build가 통과했다. backend unitTest·bootJar는 UP-TO-DATE 결과를 재사용했다. 기존 k6 shell runner 테스트도 exit 0이었다.

코드 커밋은 `9c0a94c`다. 실제 grafana/k6:0.54.0 컨테이너에서 inspect를 실행해 모듈 로딩·per-vu-iterations 20 × 50·2분 상한·기존 threshold를 확인했다. inspect에는 k6 CLI의 -e 인자로 입력을 전달했다. 처음 Docker 환경변수만 전달한 inspect는 입력을 받지 않아 BIDFLOW_BASE_URL 누락으로 실패했으며, HTTP를 제출한 실행은 없었다.

## 다음 단계

같은 #19에서 외부의 새 출력 경로·symlink/충돌 보호, 가짜 I/O의 timeout/부분 기록, 안전한 Docker mount, CPU/메모리·Lag/DLT 관측, 실제 시계와 프로세스 설정 확인·복원, 전체 실행 판정을 연결한다. 그 뒤 별도 10건 smoke와 새 경매의 정식 1,000건을 실행한다. 실패 결과와 미완료를 보존하고 성능·정합성·실행 유효성을 분리한다.

이번에는 브라우저 E2E·전체 backend integration check·새 부하·AWS를 실행하지 않았다. 앱/의존성·실행 중 API·기존 데이터·offset·전역 설정과 원본 폴더의 미추적 파일은 바꾸지 않았다. #19와 상위 프로젝트의 완료 조건은 아직 충족됐다고 표시하지 않는다.
