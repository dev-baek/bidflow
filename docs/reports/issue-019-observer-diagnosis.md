# 집중 부하 실패의 관측 명령과 HTTP 지연 진단

[#288의 585건 중단](issue-019-focused-load-collector.md)을 이어서 기존 증적·로그·접수 코드와 읽기 전용 명령을 점검했다. 관측 명령 자체가 수 초 걸리고 과거 HTTP 분포에서 응답 대기가 길었다는 것은 확인했다. **실패한 명령과 API 병목의 확정 원인은 아직 알 수 없다.** 입찰을 새로 생성하거나 1,000건 부하를 재실행하지 않았다.

## 관측 명령 기저 측정

2026년 11월 22일 02:03:00–02:03:39 UTC, main `5baf4c4`에서 기존 BidFlow 컨테이너 5개만 읽었다. Docker stats·OOM inspect·bid-settlement Lag 조회를 순차로 3회, 동시에 시작하는 방식으로 3회 실행했다. 각 호출의 시작/완료는 같은 Node performance 시계로 기록했으며 기존 5초/12초 상한을 유지했다. [원본과 검증 정보](evidence/issue-019-observer-diagnosis.json)에 18개 결과를 보존했다.

| 실행 | Docker stats ms | OOM inspect ms | Kafka Lag 조회 ms |
|---|---:|---:|---:|
| 순차 1 | 2,759.50 | 155.90 | 5,278.10 |
| 순차 2 | 2,715.48 | 676.12 | 5,235.44 |
| 순차 3 | 2,463.39 | 143.12 | 4,257.08 |
| 동시 1 | 3,176.80 | 439.58 | 4,440.64 |
| 동시 2 | 2,838.59 | 152.09 | 2,768.09 |
| 동시 3 | 2,615.30 | 231.76 | 4,100.64 |

18개 모두 제한 안에 성공했다. 이 작은 표본으로 동시 실행이 항상 느리다고 말할 수는 없다. 순차 실행 뒤 동시 실행을 측정한 비무작위 순서이고 캐시·백그라운드 작업을 통제하지 않았다.

stats의 최대 관측값은 5초 제한 중 약 3.18초, Lag 조회의 최대 관측값은 12초 중 약 5.28초였다. 입찰이 없어도 관측 호출은 즉시 끝나지 않는다. 수집기의 정책은 조회 완료 뒤 3초 대기이므로 실제 조회 주기는 3초 고정이 아니다. 하지만 이번에는 timeout을 재현하지 못했으며, 이 결과로 과거 stats 또는 Lag가 실패 명령이었다고 확정하지 않는다.

측정 중 API는 원래 local/명시적 1,000ms/INFO를 유지했다. 과거 실패 때의 local/100ms/INFO와 조건이 다르고 다른 개발 컨테이너도 실행 중이었다. 기록한 hostBusyPercent는 측정 구간 전체 호스트 CPU의 평균이며 특정 관측 명령의 CPU 비용이 아니다. 이 자료는 관측 켜기/끄기의 인과 비교나 부하 처리량 결과가 아니다.

## 과거 HTTP 지표를 다시 구분한 결과

기존 585개 응답의 k6 summary에 아래 구간별 분포가 이미 남아 있었다. 새 HTTP 요청으로 측정한 값이 아니다.

| k6 지표 | P95 ms |
|---|---:|
| duration | 620.5990 |
| blocked | 0.0639 |
| connecting | 0 |
| sending | 0.2185 |
| waiting | 620.1756 |
| receiving | 3.7936 |

[k6 0.54.0의 원본 tracer](https://github.com/grafana/k6/blob/v0.54.0/lib/netext/httpext/tracer.go#L295-L356)에서 duration은 sending+waiting+receiving이며 초기 연결 시간과 구분된다. waiting은 첫 응답 바이트를 기다리는 구간으로, DB 실행 시간 그 자체가 아니다. [공식 응답 timing 설명](https://grafana.com/docs/k6/latest/javascript-api/k6-http/response/)도 같은 구분을 제공한다.

따라서 이 분포는 응답 대기가 길었다는 근거이지 DB 쿼리·커넥션 풀·스레드 대기·네트워크 중 하나를 지목하는 근거는 아니다. 서로 다른 요청에서 나온 P95를 빼거나 더해 지연 기여도를 계산하지 않는다. 기존 tuple에는 요청별 duration만 있어 구간별 표본을 요청 단위로 재연결할 수도 없다.

## 접수 경로와 로그의 범위

BidRequestController → BidRequestIdempotencyService → JdbcBidRequestRepository를 확인했다. 접수는 기존 멱등 요청 조회와 트랜잭션의 bid_request/Outbox INSERT를 수행한다. 이 경로가 Kafka 최종 정산이나 Redis 계산 결과를 동기로 기다리지는 않는다. 다만 Consumer·Publisher와 DB/CPU 등을 공유하므로 간접 경합 가능성은 남는다. DB pool 크기나 SQL 실행 시간, 서버 요청 진입부터 응답까지의 구간은 이 증적에 없다.

알려진 585개 requestId만 대상으로 원문 로그를 필터링했다. 실험 JVM의 bid.request.received는 585개, bid.settled는 559개였다. 복원 JVM 로그에 나머지 bid.settled 26개가 있고 두 파일의 정산 ID 합집합은 정확히 585개였다. 이는 기존 사후 SQL의 585건 최종 처리와도 맞는다. 실험 JVM 로그만 보고 26건이 유실됐다고 판단하면 안 되며, 로그 자체를 트랜잭션 커밋 시각이나 SQL 증명의 대체물로 사용하지 않는다.

확인한 접수/정산 이벤트에 durationMs/requestDurationMs/elapsedMs 필드는 없었다. CorrelationIdFilter도 상관 ID를 전달할 뿐 요청 전체 시간을 측정하지 않는다. 현재 자료만으로 서버 내부 병목 구간을 복원할 수 없다. 원문 메시지·환경변수·토큰은 보고서에 옮기지 않았고 허용된 이벤트별 집계만 저장했다.

## 다음 결정과 유지할 경계

다음 구현은 [관측 명령 추적 사양](../specs/issue-019-observer-command-trace.md)에 따라 명령별 실제 소요/종료 결과와 HTTP 구간 요약을 남기는 것이다. 문서 승인 전에는 구현하지 않는다. 관측 비용을 줄이거나 DB pool·인덱스·앱 동작을 바꾸는 결정은 필요한 계측 뒤 따로 검토한다. timeout·부하 VU·성능 임계값을 바꾸지 않는다.

이번 진단의 valid는 읽기 전용 측정 완료이지 과거 실패의 해결이나 1,000건 성공이 아니다. 기존 API의 PID 792·실행 인자·jar hash와 서비스 health는 전후 같았다. 새 상품/입찰·서버 재시작·데이터/볼륨/offset 변경·AWS 작업은 없었다. #19는 열린 상태이며 실패 기록을 유지한다.
