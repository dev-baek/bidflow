# 명령 추적을 포함한 집중 부하 재검증 계획

- 상태: #291 병합으로 승인됨. 새 smoke 10건과 별도 새 경매의 1,000건을 각각 한 번 실행해 통과했고 원래 API를 복원했다. [실행 결과](../reports/issue-019-instrumented-rerun.md). 아래는 승인된 실행 계약이다.
- 기존 이슈: [#19](https://github.com/dev-baek/bidflow/issues/19). 같은 검증 범위이므로 새 이슈를 만들지 않는다.
- 기준 계약: [1,000건 집중 부하](issue-019-focused-thousand-requests.md), [명령 추적](issue-019-observer-command-trace.md).
- 선행 증적: [585건 중단](../reports/issue-019-focused-load-collector.md), [진단](../reports/issue-019-observer-diagnosis.md), [계측 구현과 읽기 전용 검증](../reports/issue-019-observer-command-trace.md).

## 목적과 이번 실행의 의미

#290의 계측이 실제 입찰·정산·자원/명령 관측·복원까지 연결되는지 확인한다. 기존 CLI로 새 10건 smoke 한 번을 수행하고, 성공한 경우에만 별도 새 경매의 1,000건을 한 번 수행한다. 새 진단 모드·의존성·서버 내부 계측은 추가하지 않는다.

이 실행은 관측을 켜거나 끄는 대조 실험이 아니다. 과거 실행 뒤 SQL/수집기가 보완됐고 공유 Mac의 배경 상태도 통제하지 않으므로, 결과 차이로 계측이나 SQL 수정의 성능 효과를 단정하지 않는다. 새 실행이 성공해도 과거 585건 중단의 원인을 소급 확정하지 않는다.

## S. 화면과 사용자 흐름

화면과 API 계약은 바꾸지 않는다. 실제 시계의 새 시험 경매에 합성 actor의 직접 입찰만 제출하며, 202 접수와 최종 승인/거절을 구분한다. 브라우저/WebSocket 전달 P95나 AWS 사용자 여정은 이번 결과에 포함하지 않는다.

## D. Fixture와 증적 분리

smoke와 본 실행은 서로 다른 runId·상품/경매 UUID·출력 디렉터리를 사용한다. 각 경매의 시작가 10,000원·초기 version 1·마감까지 30분 이상, 요청별 금액/키/actor 공식과 SQL 불변식은 기존 사양을 그대로 따른다. 기존 데이터·키·offset·볼륨은 삭제하지 않는다. 새 시험 데이터도 증적으로 보존한다.

과거 실패·smoke·본 실행은 별도 결과다. smoke의 10건을 본 실행 1,000건에 더하지 않고 재실행의 좋은 표본만 골라 합치지 않는다. 보고서에는 계획/제출/유효 접수/완료 iteration/최종 판정/미완료 수를 각각 남긴다.

필수 증적은 다음과 같다.

- 실행 source SHA, 실제 Java/Node/k6·이미지 식별자·호스트/Docker 자원, 서비스 상태, 프로필/시계/Outbox 간격과 jar hash
- 접수 기록과 요청/원장/결과 이벤트의 ID·키·actor·금액 대조, 승인 가격/version·최종 승자/마감 검증
- k6 원본 숫자 summary, HTTP duration 및 다섯 구간의 요약, 오류율과 표본 수
- loadStartedMs/loadEndedMs, commandTrace의 operation/ID/시각/제한/결과·잘림 여부, diagnosticsComplete
- CPU/메모리/OOM, Lag 전·중·후 표본과 조회 간격, DLT offset 전후 및 확인 누락
- 원래 API와 검증 JVM의 종료/상태 확인, 복원 인자/jar hash/listen PID/readiness

원문 환경·argv·SQL·stdout/stderr·HTTP 본문·토큰을 trace에 붙이지 않는다. 결과 파일은 저장소 밖의 새 보호된 디렉터리에 쓰고 커밋할 증적은 허용된 필드로 정리한다.

## B. 기존 도구와 판정 유지

scripts/run-focused-load.mjs와 collectFocused, 기존 순수 요청/SQL/자원/명령 추적 판정을 재사용한다. 기본 경로는 다음과 같으며 결과 디렉터리는 아직 없어야 한다.

```sh
node scripts/run-focused-load.mjs <새-외부-디렉터리>/smoke smoke
# 실제 exit 0과 JSON 판정을 확인한 뒤 별도 경매의 본 실행
node scripts/run-focused-load.mjs <새-외부-디렉터리>/full full
```

smoke는 2 VU × 5회, 본 실행은 20 VU × 50회다. 기존 100ms 요청 뒤 대기, HTTP 5초·부하 120초·회복 관측 60초, 일반 명령 5초·Lag/DLT 12초·정리 명령 10초, 관측 완료 뒤 3초 대기, 512개 trace 상한을 유지한다. CPU 약 1초 표본 5개 연속 90% 이상·심각한 메모리 압박·OOM·관측 오류의 기존 중단 기준도 유지한다. 오류를 피하려고 관측을 끄거나 VU/건수/임계값을 낮추지 않는다.

명령 추적이 완전해도 실패 명령이 있으면 전체 관측 성공이 아니다. phaseSummary/commandTrace가 누락·불완전·잘림이면 SQL 정합성만으로 성공을 선언하지 않는다. 메트릭 백분위를 합산/차감하지 않고 DB 처리 시작/사후 관측을 정확한 커밋·화면 전달 시간으로 바꾸지 않는다.

## I. 준비와 API 복원

승인된 main의 소스를 고정하고 make verify/bootJar 및 실제 패키지의 local 100ms 설정을 확인한다. 유효 설정·jar hash와 override 없는 환경을 기록한다. 테스트 Clock과 다른 합성 부하/장애 주입이 겹치지 않아야 한다. 로컬 Unix socket Docker·BidFlow 서비스 healthy·정산 그룹 세 partition Lag 0을 확인한다.

현재 API가 local/명시적 1,000ms 등 다른 설정이면 소유 PID·정확한 인자·jar hash를 읽고 기록한 뒤 별도 실행 관리에서 완전 종료한다. 소유권이 불명확하면 해당 프로세스를 중단하지 않고 실행을 보류한다. 검증 JVM은 기존 CLI가 요구하는 이 작업 폴더의 jar/local/system Clock/loopback/100ms/INFO로 띄운다. CLI가 API를 자동 교체한다고 가정하지 않는다.

검증 뒤에는 성공 여부와 무관하게 소유 부하 컨테이너와 검증 JVM을 정리하고 원래 API의 jar·인자·실행 여부로 복원한다. 포트 해제만으로 JVM 종료를 판단하지 않는다. CLI 내부 restoration은 검증 API의 상태 불변 확인이고, 원래 API로의 실제 복원은 별도 실행 관리의 기록으로 구분한다. 복원 실패 시 추가 부하를 중단하고 현재 상태와 필요한 조치를 보고한다.

다른 개발 컨테이너를 임의로 중단하거나 Docker 자원·JVM/DB pool·인덱스·Spring 설정을 튜닝하지 않는다. AWS·원격 주소·Cognito·배포·데이터 초기화는 범위 밖이다.

## T. 실행 횟수와 완료 판정

1. 실행 전 기존 make verify와 명령 추적/collector 회귀 결과를 확인한다. 도구 결함 수정이 필요하면 실패 테스트와 최소 수정을 먼저 커밋하고, 바뀐 SHA를 기록한다.
2. 새 smoke를 정확히 한 번 실행한다. exit 0, valid=true, fullVerified=false와 정합성·자원·진단·명령 성공·상태 확인을 모두 확인해야 다음 단계로 간다. 실패하면 본 실행은 시작하지 않는다.
3. 통과 후 새 경매의 본 실행을 정확히 한 번 수행한다. 성공 여부에 관계없이 표본/실패/정리·복원을 보존한다. 실패를 같은 SHA/Fixture로 자동 재시도하지 않는다.
4. 전체 성공은 기존 1,000건 SQL 불변식·유효 접수/완료 카운터·Lag/DLT·자원·진단 완전성·상태 확인/복원과 API P95 300ms 미만·HTTP 오류율 1% 미만을 모두 충족한 경우뿐이다. HTTP 오류율이 기준 미만이어도 누락 요청이 있으면 전체 성공이 아니다.

| 결과 | 해석과 다음 조치 |
|---|---|
| 명령/자원/진단 실패 | 전체 실행 무효/미완료. 정확한 operation·결과·제한·시각을 남기며 완료 응답 분포만 제한적으로 기술한다. 더 큰 부하를 시작하지 않는다. |
| 관측·정합성은 유효, 성능 기준 미달 | 새 로컬 조건의 성능 실패로 보고한다. 서버 내부 병목을 단정하지 않고 별도 진단 계획을 세운다. |
| 모든 기준 충족 | 해당 시점 local/100ms·20 VU 누적 1,000건의 성공이다. 과거 실패 원인 해결·1,000건 전체 동시 HTTP·AWS SLO 달성은 아니다. |
| 정리/복원 실패 | 성공 선언을 보류하고 추가 실행을 중단한다. 원래 상태와 현재 상태를 명확히 보고한다. |

새 결과는 코드/증적 PR로 검토받는다. 이 계획의 병합만으로 #19를 닫거나 아직 실행하지 않은 작업을 완료 처리하지 않는다. 원인 분석 또는 조건 변경 뒤 추가 실행이 필요하면 별도 계획/SHA/runId로 추적한다.
