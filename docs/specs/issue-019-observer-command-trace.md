# 집중 부하 관측 명령 추적 사양

- 상태: #289 병합으로 승인됨. [명령 추적 구현·읽기 전용 검증](../reports/issue-019-observer-command-trace.md)을 기록했다. 추가 입찰 부하와 과거 실패 원인 확정은 완료하지 않았다.
- 기존 이슈: [#19](https://github.com/dev-baek/bidflow/issues/19). 새 이슈를 만들지 않는다.
- 근거: [첫 실패](../reports/issue-019-focused-load-collector.md), [읽기 전용 진단](../reports/issue-019-observer-diagnosis.md), [기존 부하 계약](issue-019-focused-thousand-requests.md).

## 목표와 비목표

기존 sampler 수준의 containers 오류만으로는 Docker stats와 OOM inspect 중 어느 명령이 실패했는지 알 수 없다. 실행 경계에 작은 추적을 추가해 **어느 명령이 언제 시작/종료됐고 어떤 제한 아래 실패했는지** 확인한다. 동시에 기존 k6 summary의 HTTP 구간 지표가 최종 증적에서 빠지지 않게 한다.

새 모니터링 플랫폼·의존성·대시보드·DB schema를 만들지 않는다. timeout 확대·오류 무시·재시도·관측 끄기·샘플링 간격 변경·DB pool 튜닝·API 지연 개선은 이번 변경이 아니다. 과거 실패를 성공으로 다시 판정하지 않는다.

## S. 화면과 사용자 결과

화면과 API 응답은 그대로다. 운영자가 JSON 증적에서 관측 실패 명령과 HTTP 지표의 종류를 구분할 수 있게 한다. 진단 기록이 없으면 이유 미확정으로 표시하며 0ms나 성공으로 채우지 않는다.

## D. 기록 계약

기존 실행 JSON에 commandTrace를 추가한다. 명령당 하나의 레코드로 시작과 완료를 연결하며 아래 허용 필드만 보존한다.

- 실행 내 단조 증가 commandId, 고정 operation enum
- 시작/종료 상대 ms와 durationMs, 실제 설정 timeoutMs
- 성공/실패/종료 원인 미확정/출력 제한 등 고정 outcome, 종료 코드 또는 signal의 허용 값

operation은 CONTAINER_STATS, CONTAINER_OOM, KAFKA_LAG, KAFKA_DLT, SCOPED_SQL, SETUP_METADATA 등 코드가 지정하는 고정값이다. 프로그램·argv·SQL 원문·stdout/stderr·환경변수·예외 메시지를 이름이나 metadata로 복사하지 않는다. 레코드는 기존 loadStartedMs/loadEndedMs와 같은 io.now 단조 시계로 기록한다. 두 명령이 겹쳐 실행돼도 각 commandId의 시작/완료가 뒤섞이지 않아야 한다.

상한은 명령 512개로 고정한다. 기존 약 3분 내 부하/회복과 CPU probe·메타데이터 조회를 담는 유한 범위이며 메모리/증적의 무제한 증가를 막는다. 초과하면 truncated를 명시하고 진단 완전성을 확인하지 못한 것으로 처리한다. 오래된 레코드를 지워 최신 기록만으로 전체 관측 성공을 만들지 않는다.

HTTP phaseSummary는 k6 summary의 blocked/connecting/sending/waiting/receiving에 대해 med/p(95)/p(99)를 허용된 숫자만 보존한다. 기존 duration과 의미를 섞지 않는다. 누락·음수·비유한 값은 null/미확인으로 남기며 구간 요약의 완전성은 별도 판정한다. 기존 과거 증적은 덮어쓰거나 새 필드를 추정해 채우지 않는다.

## B. 최소 구현과 오류 의미

scripts/run-focused-load.mjs의 실제 명령 실행 경계와 scripts/focused-load-collector.mjs의 증적 연결을 우선 사용한다. 기존 순수 판정·SQL·k6 입찰 요청 동작은 바꾸지 않는다. 명령 실행은 정확히 한 번이며 원래 결과/오류를 유지한다. 진단 기록을 남긴다는 이유로 외부 효과를 다시 실행하지 않는다.

기존 killed=true 하나만으로 정확한 timeout을 확정하지 않는다. 명령 경계에서 확인한 timeout과 출력 제한을 구분하고, 종료 원인이 불명확하면 TERMINATED/UNKNOWN으로 남긴다. 시간 예산과 관측 소요를 함께 보존하되 예산 초과만으로 OS 종료 원인을 단정하지 않는다. 기록 순서 역전·미완료·상한 초과는 새 실행의 진단 불완전으로 드러내고 전체 성공으로 숨기지 않는다.

오류가 난 명령의 시작 기록과 이미 완료된 기록은 기존 부분 실패 저장/정리/상태 확인 경로에 남긴다. 프로세스 강제 종료에도 파일이 완전 보존된다고 보장하는 별도 시스템은 추가하지 않는다. 원본 실패 로그를 JSON에 통째로 붙이지 않는다.

## I. 검증과 실행 범위

기존 새 외부 출력 디렉터리·Git worktree 거부·로컬 Docker/loopback·읽기 전용 소스 mount·API 설정 확인·복원 원칙을 유지한다. 관련 명령의 5초/12초 제한, HTTP 5초·부하 120초·회복 60초와 CPU/OOM 중단 기준도 유지한다. 원문 환경변수나 자격증명을 저장하지 않는다.

이번 사양의 실제 실행 검증은 **새 입찰 없는 읽기 전용 명령**까지다. 같은 stats/inspect/Lag 명령을 고정된 대상에 제한된 횟수로 실행해 trace의 소요·결과·개수와 API/서비스 상태 불변을 확인한다. 이 검증을 새 smoke나 1,000건 성공으로 부르지 않는다. 추가 부하 비교와 서버 내부 계측은 이 결과를 보고 별도 계획을 확정한다. AWS·API 재시작·Fixture 삽입·인프라 변경은 필요 없다.

## T. TDD와 완료 기준

1. 가짜 exec/clock의 RED부터 작성한다. 성공·일반 실패·확인된 timeout·원인 미확정 종료·출력 제한·기록 누락/중복·시계 역전·512개 초과·동시 완료 순서 역전을 검증한다.
2. 원래 명령의 반환/오류와 호출 한 번을 보존하는 최소 GREEN을 만든다. argv/응답/환경/예외에 넣은 임의 비밀값이 trace에 없는지 확인한다.
3. HTTP 구간 요약 누락·음수·NaN·Infinity를 성공으로 포장하지 않고 기존 P95 300ms 판정과 구분하는 테스트를 작성한다. 서로 다른 구간 백분위를 합하거나 빼지 않는다.
4. 기존 collector·SQL·k6·부분 기록/정리 테스트와 make verify/최신 PR CI를 통과시킨다. 새 진단 로직만 확인하면서 기존 요청/정합성 계약을 약화시키지 않는다.
5. 소스를 커밋한 뒤 제한된 읽기 전용 실측으로 trace와 실제 실행 개수를 대조한다. API·서비스 상태 불변과 미확인 항목을 보고하고 #19를 열린 상태로 둔다.

완료는 명령/HTTP 종류별 증적이 안전하게 남는다는 뜻이다. 첫 실패 명령의 소급 확정, 관측 비용과 앱 지연의 인과 증명, DB 병목 확정이나 1,000건 부하 달성을 뜻하지 않는다.
