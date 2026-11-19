# [Issue #19] 로컬 최종 정산 관측 지연

- 사양: [최종 정산 관측 지연](../specs/issue-019-final-settlement-latency.md)
- 실측일: 2026-11-19, Spring Boot `local`, 실제 시계, Java 21.0.7
- 본 실행 commit: `67bd7d7bce35ebeb38d055c90b58173596ff4e2b` (앱은 #258 병합 기준, 이 commit에 측정기 포함)
- 환경: arm64 macOS, 8 CPU·16 GiB, Docker 27.5.1(8 CPU·약 7.65 GiB), Node 20.19.4. PostgreSQL·Kafka·Redis는 healthy 상태에서 시작했다. OpenSearch·SeaweedFS도 실행 중이었다.

## 결과

새 활성 경매에 서로 다른 사용자 20명이 각 20,000원 직접 입찰을 한 번씩 제출했다. 시작가는 10,000원, 마감은 약 30분 뒤였다. 이 실험은 기존 k6 부하를 재실행한 것이 아니라 새 Node 관측기의 제한된 별도 회차다.

| 지표 | 본 실행 |
|---|---:|
| HTTP 202 / 전체 | 20 / 20건 |
| 확정 관측 / 미완료 | 20 / 0건 |
| 판정 | 승인 1건 · 거절 19건 |
| HTTP 전송 → 응답 본문 수신 P50 / P95 / P99 | 45.25 / 51.98 / 53.31ms |
| HTTP 전송 → 최종 DB 관측 P50 / P95 / P99 | **1,238.70 / 1,245.38 / 1,248.46ms** |
| 요청 / 원장 / 원장 중복 | 20 / 20 / 0건 |
| 최종 현재가·승자 | 20,000원, 마지막 승인 원장과 일치 |
| Kafka 정산 Lag 전·후 | 세 partition 모두 0 |
| 조회 완료 간 최대 간격 | 약 314.54ms |

백분위는 nearest-rank이며 **완료 표본 20건 기준**이다. 확정 판정은 별도 PostgreSQL 연결의 한 읽기 전용 SELECT에서 요청 상태, 원장 판정 1건, 해당 요청의 결과 Outbox 1건이 일치했을 때다. 원장/결과 이벤트 확인이 없는 요청 상태만으로 완료를 세지 않았다.

조회는 순차로 4회 실행했고, 조회 한 번에 약 204~215ms가 들었다. 완료 뒤 100ms 대기 정책 때문에 실제 관측 간격은 100ms가 아니다. 정확한 커밋 시각은 알 수 없으며, 표의 DB 관측 지연은 관측·조회 비용을 포함한 상한이다. HTTP 응답 이전에 완료된 상태도 응답으로 요청 ID를 얻은 뒤 관측하므로 그 지연이 포함된다.

같은 금액의 경쟁으로 승인 표본이 1건이다. SQL상 가격 역행은 0건이지만 여러 승인 간 단조성의 별도 증명은 아니다. 1,000건 동시 HTTP, 포화 처리량, 장시간 부하, 브라우저/WebSocket 전달 P95 또는 AWS 성능을 측정한 것은 아니다. CPU·메모리 압박의 연속 표본도 수집하지 않아 이 단일 회차를 운영 SLO 달성으로 일반화하지 않는다.

## 증적과 사전 점검 실행

- [본 실행 원본](evidence/issue-019-final-observation.json): commit·Fixture·요청별 상대 시각·판정·쿼리 구간·Lag·불변식.
- [사전 smoke 원본](evidence/issue-019-final-observation-smoke.json): 측정기 최초 연결 확인. `bdaa3cd` 기반 작업 트리에서 실행해 완료 20건, DB 관측 P95 약 948.10ms였다. 소스 commit이 고정된 본 실행과 합쳐 성능 개선/악화로 해석하지 않는다.
- 과거 `processed_at - requested_at` 자료는 여전히 처리 시작 지연이다. 이번 결과로 그 과거 지표의 이름을 바꾸지 않는다.

## 재현

실행 중인 로컬 API와 BidFlow Compose PostgreSQL·Kafka·Redis가 필요하다. 도구는 새 합성 상품·경매만 삽입하고, 요청·관측 조회는 고정된 로컬 주소와 해당 Fixture에 한정한다. 기존 데이터나 볼륨을 초기화하지 않는다. 다른 부하·장애·테스트 Clock 변경과 병행하지 않는다.

```sh
node --test tests/scripts/final-settlement.test.mjs tests/scripts/measure-final-settlement.test.mjs
node scripts/measure-final-settlement.mjs /tmp/bidflow-final-observation-new.json
```

출력 경로는 저장소 밖의 **아직 없는 파일**이어야 한다. 경로 충돌은 서비스 접근 전에 거부한다. 입력 주소를 받지 않으며 AWS 자격 증명은 사용하지 않는다. HTTP/SQL timeout과 최대 60초 관측 제한을 사용하고, 실패·미완료가 있으면 원본 파일을 보존한 채 비정상 종료한다. 출력의 `valid`는 측정 완료와 이번 불변식 판정이지 운영 SLO 검증 결과가 아니다.

## 다음 검증

이번에 최종 DB 가시성을 측정했지만, 상위 사양의 사용자 최종 결과 P95 2초를 브라우저에서 검증한 것은 아니다. #19는 이를 구분해 열린 상태로 둔다. Kafka Lag의 이번 자료도 실행 전후 표본이며 실행 중 피크나 정확한 회복 시간을 뜻하지 않는다.
