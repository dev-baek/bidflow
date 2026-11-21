# 입찰 승인 안내의 처리 시점 수정과 브라우저 검증

[#281에서 승인한 사양](../specs/issue-020-bid-result-timing.md)에 따라 기존 #20의 승인 안내를 “이 요청 처리 당시 최고 입찰자였습니다/아니었습니다”로 바꿨다. 다른 사용자가 추월해 공개 가격이 바뀌어도 과거 승인 결과를 현재 순위처럼 표시하지 않는다. 현재 최고 입찰 상태 조회 기능을 추가한 것은 아니다.

## 변경과 유지한 계약

BidRequestForm의 기존 ACCEPTED 조건과 isHighestBidder 분기는 유지하고 두 문자열만 교체했다. role=status, 거절·접수·오류 표현, 순수 reducer의 요청 ID 매칭, 재시도 키와 개인 결과 처리에는 변경이 없다. 서버·메시지 schema·DB·인증·가격 계산도 그대로다.

정확한 문구를 찾던 Playwright 단언과 순차 지연 관측의 approval locator를 함께 바꿨다. 요청/금액/개인 frame/공개 화면 완료 조건, 시계와 timeout·P95 2초 기준은 유지했다. 동시 관측 함수·SQL 판정도 변경하지 않았다.

## TDD와 기본 검증

새 컴포넌트 테스트 3개를 먼저 추가했다. true/false 승인 2개는 과거 시점 표현 대신 기존 현재형 문구가 나와 실패했고, 거절을 승인으로 표시하지 않는 테스트는 기존 코드에서도 통과했다. 문구의 최소 변경과 기존 false 기대값 갱신 뒤 폼 7개·상태 3개의 테스트가 통과했다.

전체 make verify에서 Vitest 71개와 Node 스크립트 57개, TypeScript/Vite build가 통과했다. 로컬 backend unitTest·bootJar는 기존 결과를 UP-TO-DATE로 재사용했으며 전체 통합 check를 재실행한 것은 아니다. 별도 E2E TypeScript 검사도 통과했다. 새 의존성이나 lock 변경은 없다.

## 실제 브라우저 검증

- 소스 commit: `c4e069edb95cd3374c66d0c79ef6f3ee5d12e35d`. 코드 커밋 후 실행했다.
- 실행/복원: 2026년 11월 21일 04:16:46–04:17:31 UTC. Chromium 145.0.7632.6, Node 24.18.0, Java 21.0.7.
- 기존 API 완전 종료 후 local,e2e/100ms/INFO와 임시 Vite를 사용했다. worker 1·retry 0, 새 시험 데이터이며 자동 재시도는 없다.

| 기존 사례 | 확인한 내용 | 결과 |
|---|---|---|
| 자동입찰·낙찰 불변 | A/B의 true/false 안내 모두 새 문구. 연장·낙찰/패찰·비참여와 최대가 비공개 등 기존 단언 유지 | 통과 |
| 직접입찰·재시도 | A 12,000원 승인 뒤 B 13,000원으로 양쪽 공개가 갱신. A 안내는 처리 당시 문구로 남고 현재 최고 단정은 없음. 이후 새 14,000원 요청/키도 확인 | 통과 |
| 순차 20건 관측 | 새 정확한 locator로 개인 결과와 양쪽 가격 20건 완료. 기존 2초 기준 유지 | 통과 |

Playwright JSON 결과는 성공 3개·실패/skip/flaky 0개였다. [허용 필드로 정리한 실행 증적](evidence/issue-020-bid-result-timing.json)에 사례별 결과와 retry 횟수, 순차 관측 입력·상대 시각, 실행/복원 정보를 남겼다. 원문 reporter·서버 로그·Token·trace·전체 frame은 커밋하지 않았다.

순차 관측의 화면 완료 P95는 431.43ms였다. 이는 locator가 실제 경로에서 동작하는 회귀 확인으로 기록하며, 문구 수정의 성능 개선이나 동시 부하 결과로 해석하지 않는다. 기존 [동시 2인 실측](issue-019-concurrent-snapshot-fix.md)의 443ms 결과와 합치지 않는다.

## 복원과 범위

검증 JVM과 Vite가 완전히 종료된 뒤 원래 jar hash와 local/명시적 1,000ms/INFO 인자로 API를 복원했다. 실제 listen PID 45746·실행 인자·readiness UP을 확인했다. Vite는 다시 꺼졌고 E2E Clock도 검증 JVM과 함께 종료됐다.

신규 시험 데이터는 보존했으며 삭제·볼륨/Redis 키/offset reset·AWS 작업은 없다. 원본 작업 폴더의 미추적 복제 파일과 루트 package-lock.json도 건드리지 않았다.

나머지 4개 E2E, 전체 backend integration check, 새 동시 부하나 AWS 배포를 검증한 결과는 아니다. 이 수정은 안내의 시점 혼동을 해결하지만 현재 순위를 실시간 보장하지 않는다. #20의 AWS 사용자 여정 검증은 별도 승인 후 #91에서 진행하므로 이 PR에서 이슈를 종료하지 않는다.
