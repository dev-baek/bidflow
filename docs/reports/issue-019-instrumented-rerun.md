# 명령 추적을 포함한 집중 부하 재검증 결과

[#291 승인 계획](../specs/issue-019-instrumented-rerun.md)에 따라 새 smoke 10건을 한 번 실행하고, 통과 후 별도 새 경매에 20 VU × 50회로 1,000건을 한 번 제출했다. **본 실행은 유효 접수·완료 iteration·요청·원장·결과가 각각 1,000건이며 전체 판정을 통과했다.** 접수 API P95는 290.48ms로 300ms 미만 기준을 충족했고 HTTP 오류율은 0%였다. 검증 후 원래 API를 복원했다.

이 결과는 공유 Mac의 local/100ms 설정에서 누적 1,000건을 검증한 것이다. 과거 [585건 중단](issue-019-focused-load-collector.md)은 별도 실패 기록으로 유지한다. 관측/SQL 보완과 배경 상태 차이가 있으므로 두 실행의 차이를 성능 개선 효과나 과거 실패 원인 해결로 해석하지 않는다.

## 실행 환경과 범위

- 실행 소스: `7e07c9c553a5b6b99a6229811ac887e5a7219d0a` (#291 병합 main). 실행 중 소스/임계값/설정을 수정하지 않았다.
- 실행과 실제 API 복원: 2026년 11월 22일 02:49:33–02:50:41 UTC (일본 시각 11:49:33–11:50:41).
- Mac15,12, arm64, 8 CPU, 16 GiB RAM. Docker 27.5.1, 8 vCPU, 메모리 8,217,858,048 bytes. 다른 개발 컨테이너는 유지한 공유 환경이다.
- Node 24.18.0, Java 21.0.7, k6 0.54.0 linux/arm64. 이미지 digest와 jar hash는 [구조화 증적](evidence/issue-019-instrumented-rerun.json)에 보존했다.
- 검증 API: local/system Clock/loopback/Outbox 100ms/INFO. 실제 로컬 Docker Unix socket과 healthy인 BidFlow 서비스 5개를 확인했다. AWS 접근·원격 배포·테스트 Clock·자원 튜닝·데이터/볼륨/offset 초기화는 하지 않았다.

기존 CLI와 순수 판정을 그대로 사용했다. 새 구현이나 의존성 없이 외부 실행 관리에서 기존 API의 소유 PID·인자·jar를 확인하고 검증 API로 교체했다. smoke와 본 실행은 서로 다른 runId·상품·경매·출력 디렉터리를 사용했다. 데이터는 보존했고 자동 재시도는 없다.

## 접수와 최종 정합성

| 항목 | 새 smoke | 새 본 실행 |
|---|---:|---:|
| 부하 계획 | 2 VU × 5회 | 20 VU × 50회 |
| 제출 HTTP / 유효 202 접수 / 완료 iteration | 10 / 10 / 10 | 1,000 / 1,000 / 1,000 |
| 최종 요청 / 원장 / 결과 이벤트 | 10 / 10 / 10 | 1,000 / 1,000 / 1,000 |
| 승인 / BID_TOO_LOW 거절 | 5 / 5 | 207 / 793 |
| 미처리 / 계획 대비 누락 | 0 / 0 | 0 / 0 |
| HTTP P50 / P95 / P99 | 16.80 / 268.99 / 280.47ms | 17.73 / 290.48 / 713.15ms |
| HTTP 오류율 | 0% | 0% |
| CLI 종료 / valid / fullVerified | 0 / true / false | 0 / true / true |

202는 입찰 승인이 아니라 접수다. 요청 금액은 VU/iteration 순서에 따라 정해지지만 실제 도착 순서가 달라 낮은 금액은 정상적으로 거절된다. 793건의 BID_TOO_LOW는 HTTP 실패가 아니다.

각 요청의 runId·키·actor·금액·접수 ID를 SQL 요청/원장/결과와 대조했다. 요청별 원장/결과는 각각 하나이며 ID 중복은 0건이다. 승인 가격은 증가했고 승인 version은 2부터 연속이다. 거절에는 원장/이벤트 가격이 없으며, 거절이 관측한 version의 승인 가격은 거절 금액보다 높았다.

본 실행의 최종 경매는 ACTIVE, 현재가 50,010,000원, version 208, 최종 승자는 계획의 마지막 actor(index 999)였다. 초기 31분 뒤 마감 시각은 유지됐다. 이는 낙찰/마감이나 5분 미만 연장 시나리오를 새로 검증한 결과가 아니다.

## 자원과 정산 관측

| 항목 | smoke | 본 실행 |
|---|---:|---:|
| 부하 시작부터 종료 관측까지 | 2.29초 | 10.16초 |
| CPU 표본 수 / 최대 | 4 / 73.53% | 11 / 89.94% |
| 컨테이너 표본 수 | 3 | 4 |
| 5개 컨테이너 메모리 합계 최대 근사값 | 2,666,985,947 bytes | 2,654,807,785 bytes |
| 관측 Lag 합계 최대 / 최종 | 0 / 0 | 241 / 0 |
| Lag 조회 표본 수 | 3 | 4 |
| DLT offset 전후 | [0,0,0] → [0,0,0] | [0,0,0] → [0,0,0] |

CPU 표본에서 5회 연속 90% 이상은 없었고, 메모리 압박 값은 모두 2, 수집한 컨테이너 OOMKilled는 모두 false였다. 기존 자원 판정이 통과했으며 본 실행의 최대 CPU 표본 간격은 1.22초였다. Docker 메모리는 표시 문자열을 바이트로 환산한 근사치다.

본 실행의 최종 SQL 정합성과 Lag 0은 부하 종료 관측 약 9.67초 뒤에 확인했다. 조회 명령의 비용과 대기를 포함한 **관측 완료 시각**이므로 정확한 마지막 DB 커밋 시간이나 Kafka 회복 지연, 화면 전달 지연으로 쓰지 않는다. 최대 Lag도 표본에서 관측한 최대이며 연속 구간의 실제 최고값을 보장하지 않는다.

## 명령 추적과 HTTP 구간

smoke 30개·본 실행 40개 명령이 모두 SUCCEEDED였고 trace complete/successful=true, truncated=false였다. HTTP 다섯 구간도 완전하게 보존돼 diagnosticsComplete=true다. 관측 실패를 감추거나 timeout을 늘리지 않았다.

| 본 실행 operation | 수 | 최소–최대 실행 시간 | 제한 |
|---|---:|---:|---:|
| SETUP_METADATA | 13 | 3.55–514.63ms | 5초 |
| KAFKA_LAG | 4 | 1,335.47–5,939.24ms | 12초 |
| KAFKA_DLT | 2 | 1,207.32–1,246.54ms | 12초 |
| SCOPED_SQL | 2 | 189.88–287.50ms | 5초 |
| CONTAINER_STATS | 4 | 1,696.05–2,704.28ms | 5초 |
| CONTAINER_OOM | 4 | 151.12–408.28ms | 5초 |
| CPU_PRESSURE | 11 | 5.64–219.64ms | 5초 |

| 본 실행 HTTP 구간 | P50 | P95 | P99 |
|---|---:|---:|---:|
| blocked | 0.007ms | 0.022ms | 3.124ms |
| connecting | 0ms | 0ms | 2.125ms |
| sending | 0.028ms | 0.184ms | 2.756ms |
| waiting | 17.439ms | 286.486ms | 705.871ms |
| receiving | 0.107ms | 1.290ms | 6.662ms |

접수 duration P95는 기준보다 약 9.52ms 낮고 P99는 713.15ms였다. 한 번의 공유 로컬 실측이므로 안정적 여유나 운영 SLO를 보장하지 않는다. waiting은 서버 내부 특정 단계의 시간과 같지 않으며 서로 다른 구간 백분위를 더하거나 빼서 원인을 계산하지 않는다.

## API 복원과 검증 증적

원래 PID 792의 local/명시적 1,000ms/INFO API를 완전히 종료한 뒤 검증 PID 23940을 시작했다. 두 CLI가 기록한 restoration은 이 검증 API의 PID·인자·jar·readiness가 바뀌지 않았다는 확인이다.

별도 실행 관리에서는 검증 JVM의 완전 종료 후 원래 jar·인자로 PID 24969를 시작했다. 원래 jar SHA-256 `5251be8d60c6fc0f3a7afb13415c72e2438713b973a854a54f411009065f08c4`, listen PID 일치와 readiness UP을 확인했다. 단순 포트 해제만으로 종료/복원을 판단하지 않았다. 실행 후 BidFlow 서비스 5개는 healthy이며 다른 개발 컨테이너도 유지했다.

실행 전 Node 24/Java 21의 make verify가 통과했다. Node 92개, 프런트 17파일/71개 테스트, TypeScript/Vite 빌드가 통과했으며 백엔드 단위 테스트와 bootJar는 UP-TO-DATE였다. 외부 실행 관리의 smoke→본 실행 통과 조건도 정상/종료 실패/진단 누락/trace 실패/잘못된 fullVerified에 대해 assert 자체 검사했다. 앱/도구 코드는 변경하지 않았다.

구조화 증적에는 원본 k6 숫자 metrics, 자원/Lag 표본, 명령별 시각/결과, Fixture, 최종 경매, 접수/원장/이벤트의 1,010개 표본 tuple을 담았다. 키/actor/금액은 sampleContract의 기존 planFocused 공식으로 재구성할 수 있다. 원본 evidence/summary/receipts의 SHA-256을 보존했고 원문 환경·argv·stdout/stderr·토큰·전체 HTTP 본문·서버 로그는 커밋하지 않았다. 원본은 저장소 밖의 보호된 임시 디렉터리에 남겼다.

커밋 전 원본 입력으로 judgeFocused/judgeResources/summarizeTrace/summarizePhases를 다시 호출해 결과와 비교했고 요청/원장/이벤트 수, 유일한 접수 ID, 분리된 runId/경매, 복원 결과를 교차 검사했다. 정리한 JSON의 tuple과 계획 공식으로 요청/원장/결과를 재구성해 같은 순수 판정을 다시 통과하는 것도 확인했다. smoke와 본 실행의 표본은 합치지 않았다.

## 남은 범위

#19의 로컬 단일 경매 누적 1,000건 재검증 증적은 확보했다. 이 PR의 검토/병합 전 이슈를 자동 종료하지 않는다. 과거 585건 중단의 정확한 원인은 여전히 미확정이며 성공한 이번 결과로 덮어쓰지 않는다. 브라우저/WebSocket 전달, 전체 backend integration, 1,000건 전체 동시 HTTP, AWS 실측은 이번 범위가 아니다.
