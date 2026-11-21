# 동시 입찰 관측 판정 구현과 단위 검증

기존 [#19](https://github.com/dev-baek/bidflow/issues/19)의 [승인 사양](../specs/issue-019-concurrent-browser-latency.md)에 따라, 첫 단계인 순수 관측 판정과 실행 집계를 구현했다. Playwright 수집기·SQL 대조와 실제 동시 입찰 실험은 후속 단계다. 이번 결과는 동시 입찰 성능 실측이 아니다.

## 구현 범위

`scripts/concurrent-browser-observation.mjs`의 `judgeConcurrentRound`는 두 사용자의 접수, 파싱된 개인 결과, 화면 관측을 입력받는다. 파일·네트워크·현재 시각을 읽지 않고 입력을 수정하지 않는다. 기존 UUID 판정과 nearest-rank 백분위 함수는 재사용하며 순차 측정 전용 `matchesObservedBid`는 변경하지 않았다.

- A의 11,000원 승인 또는 BID_TOO_LOW 거절과 B의 12,000원 승인만 허용한다. 거절 결과의 공개 현재가를 A의 제출액과 같아야 한다고 요구하지 않는다.
- HTTP 응답보다 먼저 수신한 개인 frame도 요청 ID로 연결한다. 다른 경매/요청은 일치 표본이 아니며, 해당 요청이 반대 개인 채널에 노출되면 실패다.
- 동일 결과의 반복 전달은 한 표본으로 묶고 최초 수신 시각을 사용한다. 판정·가격·version 등이 서로 충돌하는 중복 결과는 실패다.
- 두 번째 POST 관측이 첫 개인 결과보다 앞서야 동시성 조건을 충족한다. 같은 시각이나 이후라면 화면을 관측했더라도 회차 성공은 아니다.
- 양쪽 공개 12,000원과 각자의 판정 안내가 확인된 공통 시각부터 요청별 시작 시각을 빼 화면 지연을 계산한다. 잘못된 시각·10초 이상·누락된 관측은 성공 지연 표본이 아니다.

`summarizeConcurrentRun`은 서로 다른 10개 회차·경매와 20개 요청, 모든 회차의 유효한 관측과 동시성 조건을 요구한다. 빈 집합의 백분위는 null이며 부분 결과를 전체 성공으로 세지 않는다. 정상 관측의 P95 2,000ms 판정은 정합성 검증과 별도다.

브라우저 관측만으로 DB와의 일치를 보장하지 않으므로 반환값의 `sqlVerified`와 전체 `valid`는 false다. `observationValid`는 브라우저 입력에 대한 판정일 뿐이다. 후속 SQL 경계가 원장·요청·결과 Outbox와 최종 경매를 대조해야 전체 실험의 성공을 판정할 수 있다. 반환 증적은 허용된 필드만 새 객체로 구성하며 Token이나 전체 frame을 복사하지 않는다.

## TDD 증적

먼저 테스트를 추가하고 실행했을 때 구현 모듈 부재로 ERR_MODULE_NOT_FOUND가 발생했다. 최소 구현 뒤 경계 테스트를 통과시켰다. 집계 테스트의 동시성 미충족 fixture가 실제로는 첫 결과보다 앞선 시각을 사용한 오류도 확인했다. 이를 첫 결과와 같은 POST 시각으로 수정하고 HTTP 시각도 일관되게 맞췄으며, 동시성 조건 자체를 완화하지 않았다.

새 테스트는 7개이며 다음 경계를 다룬다.

1. 승인/거절 처리 순서, 응답 전 개인 결과, 입력 불변성
2. 중복 전달, 상반된 중복 결과, 개인 채널 누출
3. 잘못된 요청·경매·판정·거절 사유·접수·화면
4. 역전된 시각·비유한 수·timeout·누락 관측
5. 동시성 경계의 동등 시각 및 이후 시각 거부
6. 10회/20건 집계, 중복 ID/경매/회차, 부분·느린 결과
7. 허용 필드만 반환하고 SQL 미검증 상태 보존

```sh
node --test tests/scripts/concurrent-browser-observation.test.mjs
node --test tests/scripts/*.test.mjs
```

Node 24에서 전체 스크립트 테스트 47개가 성공했고 실패·skip은 0개다. 여기에 기존 순차 관측, DB 관측, 시작 관측 및 공통 검증 명령의 회귀 테스트가 포함된다.

## 로컬 공통 검증

깨끗한 worktree에서 Java 21과 Node 24로 make setup 및 make verify를 실행했다. 최초 setup은 기존 사용자 npm 캐시의 EACCES/EEXIST rename 오류로 중단됐다. 전역 캐시를 삭제하거나 권한을 바꾸지 않고 별도 임시 npm 캐시를 지정한 뒤 setup과 verify가 성공했다.

백엔드 unitTest는 146개, Vitest는 68개, 스크립트 테스트는 47개 성공했고 실패·오류·skip은 0개다. 새 worktree의 backend unit task 22개는 UP-TO-DATE 재사용 없이 실행됐다. bootJar와 TypeScript/Vite production build도 성공했다. 기존 전체 integration check와 브라우저 E2E는 이번에 실행하지 않았다.

설치 시 npm은 기존 lock file 기준 취약점 6건(중간 2·높음 4)을 보고했다. 이 PR은 의존성을 변경하지 않으며 audit fix를 실행하지 않았다. 공통 검증 성공은 취약점 해소를 의미하지 않으므로 별도 점검이 필요하다.

## 작업 환경과 후속 순서

원본 작업 폴더에 남은 미추적 복제 파일과 루트 package-lock.json은 수정·삭제·커밋하지 않았다. 승인 문서가 병합된 origin/main에서 별도 깨끗한 Git worktree를 만들어 작업했다. 새 의존성·앱 동작·DB migration·AWS 리소스 작업은 없다.

다음 단계는 가짜 I/O 기반 수집 경계 테스트, 명시적 플래그의 두 사용자 E2E 연결, SQL 정합성 대조, 별도 smoke와 정식 10회 실행이다. 현재는 실제 HTTP/브라우저/DB를 연결한 동시 관측이나 P95 목표 달성을 주장하지 않는다. #19는 열린 상태로 유지한다.
