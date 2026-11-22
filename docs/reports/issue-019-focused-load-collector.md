# 집중 부하 수집기 구현과 첫 실행 실패 결과

[#19 승인 사양](../specs/issue-019-focused-thousand-requests.md)에 따라 안전한 로컬 실행 수집기를 구현했다. **10건 smoke는 통과했지만, 정식 1,000건 실행은 관측 오류로 585건 접수 후 중단됐다.** 성능·관측·정합성의 전체 성공으로 세지 않는다. 실행 종료 후 기존 local/명시적 1,000ms/INFO API를 복원했다.

## 수집기와 안전 경계

scripts/focused-load-collector.mjs는 기존 순수 판정을 호출하며 실제 I/O는 scripts/run-focused-load.mjs로 분리한다. 새로운 외부 출력 디렉터리만 만들고 기존 파일·symlink를 통한 저장소 진입·다른 Git worktree·Docker mount 구분 문자가 있는 경로를 거부한다. Docker에는 소스를 읽기 전용, 해당 출력 디렉터리만 쓰기 가능으로 mount한다.

CLI는 Mac·Node 24·Java 21·로컬 Unix socket Docker와 BidFlow 컨테이너 5개의 상태를 확인한다. 포트 8080의 단일 API가 이 작업 폴더의 jar/local/system Clock/loopback/INFO 인자로 실행되고 jar의 local 설정이 100ms인지 검사한다. 관련 Spring/프로필/Outbox/JVM 환경 override가 있으면 거부한다. 환경 원문은 저장하지 않는다. 준비 상태가 다르면 새 입찰 전에 실패하며 API를 임의로 재시작하지 않는다.

CPU는 약 1초 간격, 컨테이너 메모리/OOM과 Kafka Lag는 각 조회 완료 뒤 3초 대기로 수집한다. 메모리 바이트 값은 Docker stats의 반올림된 표시를 환산한 근사치다. 명령 자체에 상한이 있고, 지속 CPU 고부하·심각한 메모리 압박·OOM·관측 실패 시 부하를 중단한다. 실제 간격은 조회 비용을 포함한다. 정산 DLT offset의 전후 변화와 요청/원장/결과 집합도 별도로 확인한다.

실행·성능·정합성·자원·API 상태 확인을 분리하고 어느 하나라도 불완전하면 valid/fullVerified는 false다. 결과 쓰기 실패에도 정리/상태 확인을 시도하며, 파일은 임시 파일을 쓴 뒤 이름을 바꿔 저장한다. 부분 JSON 접수 로그도 외부 디렉터리에 남는다. 임계값·요청 timeout·기존 focused/distributed 정책은 바꾸지 않았고 P99를 남기기 위한 새 시나리오의 summaryTrendStats만 명시했다.

## TDD와 기본 검증

실행 수집기 테스트를 먼저 작성해 미구현 모듈 실패를 확인했다. 이후 파일 쓰기 실패가 복원을 건너뛰는 RED, 잘못된 음수/누락 지표를 통과시키는 RED, 오류 발생 sampler를 구분하지 못하는 RED, 다른 worktree 안의 출력 경로를 허용하는 RED를 추가로 확인하고 수정했다. k6 P99 설정 부재와 SQL의 요청별 반복 Outbox 조회도 실패 테스트 후 보완했다.

가짜 I/O로 정상 smoke·부분 접수·SQL 실패·복구 관측 상한·DLT 증가·부하 실패·고부하/OOM·복원 실패·쓰기 실패를 검증했다. 알 수 없는 오류 메시지/응답 필드를 증적에 복사하지 않는 것도 확인했다. 신규 Node 테스트는 12개이며 최종 make verify는 Node 81개·Vitest 17파일/71개와 TypeScript/Vite build를 통과했다. backend unitTest·bootJar는 UP-TO-DATE 결과를 재사용했다.

## 실제 실행 결과

- 실행 소스: `6f43682`. 커밋 후 smoke와 정식 실행을 각각 새 경매에서 한 번씩 수행했다. 자동 재시도는 없다.
- 실행/복원: 2026년 11월 22일 01:44–01:45 UTC. 원본 시각·호스트/도구·프로필·jar hash는 [실행 증적](evidence/issue-019-focused-load-collector.json)에 있다.
- Mac15,12·8 CPU·16 GiB, Docker 8 vCPU·약 7.65 GiB. 다른 개발 컨테이너도 실행된 공유 로컬 환경이며 중단하지 않았다.
- 검증 API는 실제 시계 local/100ms/INFO, 기존 API는 local/명시적 1,000ms/INFO였다. Vite와 테스트 Clock은 사용하지 않았다.

| 지표 | smoke | 정식 실행 시도 |
|---|---:|---:|
| 계획 | 2 VU × 5회 = 10건 | 20 VU × 50회 = 1,000건 |
| 유효 접수 응답 | 10건 | 585건 |
| k6 완료 iteration | 10개 | 565개 |
| 접수 HTTP P50 / P95 / P99 | 88.07 / 166.52 / 166.72ms | 93.98 / 620.60 / 2,132.09ms |
| 완료된 응답의 HTTP 실패율 | 0% | 0% |
| 결과 | 통과, fullVerified=false | 중단/실패, fullVerified=false |

정식 시도의 585개 응답 P95는 300ms 기준도 초과했다. 자원/관측 유효성까지 실패했으므로 이 값을 유효한 1,000건 성능 결과나 포화 처리량으로 해석하지 않는다. 585개의 응답과 565개의 완료 iteration은 다른 지표이며 중단된 반복을 HTTP 실패나 성공 횟수로 임의 변환하지 않는다. 계획 대비 415건의 접수 증적이 부족하다.

smoke의 SQL은 승인 6·BID_TOO_LOW 거절 4·미처리 0이었다. Lag 전후 0과 DLT offset 불변, 자원 판정과 API 상태 확인도 통과했다. 정식 시도에서는 최대 관측 Lag 72를 기록했지만, 종료 후 Lag/DLT·SQL의 실시간 최종 관측은 완료하지 못했다. 저장된 CPU 표본에는 연속 5개의 90% 이상이나 심각한 메모리 압박이 없었고 저장된 컨테이너 표본에는 OOM이 없었다. **관측 자체가 불완전하므로 자원 문제가 없었다고 결론 내리지 않는다.**

## 실패 진단과 사후 SQL 확인

실행 빌드의 RESOURCE_OR_OBSERVATION_FAILED는 발생 sampler나 원인 코드를 저장하지 않아 어느 명령이 실패했는지는 확정하지 못했다. CLI의 Docker stats 등 일반 명령 상한은 5초, Lag/DLT는 12초이며, 정식 시도의 Lag 조회 한 번은 약 10.57초 걸렸다. 명령 제한을 늘려 통과시키지 않았다. 후속 코드에는 sampler 이름과 안전한 timeout 분류를 추가했지만 과거 실행을 그 분류로 재판정하지 않는다.

별도로 EXPLAIN에서 기존 공유 SQL이 요청별 결과 이벤트를 찾을 때 Outbox Seq Scan을 반복하는 구조를 확인했다. 요청·원장·결과 이벤트를 경매 범위에서 한 번씩 모아 그룹 조인하도록 보완했다. DB 인덱스·schema·앱 동작은 바꾸지 않았고 두 사용자 SQL의 요청 ID 필터와 결과 형식도 유지했다. 이 조회 구조를 첫 관측 실패의 확정 원인으로 단정하지 않는다.

API를 원래 상태로 복원한 뒤 보완 SQL(`a2e531d`)로 동일 실패 경매를 읽기 전용 조회했다. 585개 요청·원장·결과 이벤트가 있고 승인 122·BID_TOO_LOW 거절 463·미처리 0이었다. 접수 기록의 키/actor/금액/ID가 모두 연결됐고 각 요청의 원장·결과는 한 개, 서로 다른 원장/결과 ID도 각각 585개였다. 승인 version/가격은 증가했고 최종 경매는 30,560,000원·version 123과 마지막 승인 승자가 일치했다. 조회 완료까지 약 347ms였지만 부하가 없는 사후 조회이며 본 실행 지연 표본이나 통제된 성능 비교가 아니다.

증적의 sampleColumns와 samples에는 재계산 가능한 접수/원장/이벤트 식별자·판정·금액·상대 지연을 담았다. 585개 표본의 HTTP 백분위와 ID 유일성을 다시 확인했다. 토큰·전체 HTTP 본문·전체 서버 로그·이미지 URL은 커밋하지 않았다. 보완 코드로 새 부하를 재실행하지 않았으며, 사후 결과를 중단 시점 상태나 1,000건 성공으로 바꾸지 않는다.

## 실행 방법과 다음 작업

CLI는 API를 교체하지 않는다. 아래와 같은 정확한 로컬 실행과 override 없는 환경을 먼저 준비해야 한다. 기존 서버가 있다면 소유 프로세스·인자·jar를 기록하고 검증 후 원래 상태로 복원하는 별도 실행 관리가 필요하다.

```sh
"${JAVA_HOME:?}/bin/java" -jar "$(pwd -P)/backend/runtime/build/libs/runtime-0.0.1-SNAPSHOT.jar" \
  --spring.profiles.active=local --server.address=127.0.0.1 \
  --logging.level.com.bidflow.runtime.OutboxScheduler=INFO

# 별도 터미널, Node 24. 각 디렉터리는 아직 없어야 한다.
result_parent=$(mktemp -d)
node scripts/run-focused-load.mjs "$result_parent/smoke" smoke
# smoke가 실제 성공한 뒤 별도 새 Fixture의 본 실행을 시작한다.
node scripts/run-focused-load.mjs "$result_parent/full" full
```

이번 실측은 별도 실행 관리로 기존 JVM을 완전히 종료하고 검증 JVM을 띄웠다. 종료 후 검증 JVM의 완전 종료·원래 jar hash/인자·listen PID 792·readiness UP을 확인했다. CLI 내부 restoration은 해당 검증 API가 변경되지 않았다는 확인이고, 기존 API로의 실제 복원은 별도 실행 관리의 결과로 구분한다.

다음 #19 작업은 관측 명령 비용/timeout과 앱 접수 지연을 구분하는 진단이다. 필요하면 소규모 별도 runId로 확인하되 정식 성공으로 세지 않는다. 이후 명시적으로 새 smoke와 1,000건 검증을 진행하며 이번 실패를 보존한다. 브라우저·전체 backend integration·AWS 검증은 이번에 실행하지 않았고, 데이터/볼륨/offset 초기화나 원본 미추적 파일 변경도 없었다. #19는 열린 상태다.

후속 [읽기 전용 진단](issue-019-observer-diagnosis.md)은 기존 API를 유지한 관측 명령 18회와 과거 HTTP 구간/로그를 점검했다. 실패 재현이나 새 부하 검증이 아니며 [명령 추적 사양](../specs/issue-019-observer-command-trace.md)을 제안한다.
