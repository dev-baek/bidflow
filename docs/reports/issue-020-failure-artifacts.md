# Playwright 실패 화면과 trace 보존 확인

기존 [#20 실패 증적 계약](../specs/issue-020-e2e.md)에 따라 Playwright의 screenshot/trace 설정이 실제 실패에서 동작하는지 확인했다. **서버에 접속하지 않는 임시 fixture 한 개를 고의 실패시켜 PNG·trace ZIP·오류 문맥과 trace 안의 console 기록을 확인했다.** 설정·앱·기존 E2E 코드는 변경하지 않았다.

이것은 실패 캡처 검증이다. 업무 시나리오가 통과한 결과가 아니며, runner 종료 코드 1과 failed 1개를 그대로 기록했다. 정상 E2E나 CI에 상시 실패 테스트를 추가하지 않았다.

## 실행과 확인한 파일

- 소스: `cb4ba7318651c656d83136c01c8847a3d9285250` (#297 병합 main).
- 실행: 2026년 11월 22일 07:37:47–07:37:50 UTC (일본 시각 16:37:47–16:37:50).
- Playwright 1.58.2, Chromium 145.0.7632.6, Node 24. worker 1·retry 0, 호출 1회.
- 임시 config가 저장소의 `apps/web/playwright.config.ts`를 import/spread하고 fixture/testMatch/output/reporter/worker만 바꿨다. 기존 `use.trace=retain-on-failure`, `use.screenshot=only-on-failure`를 그대로 상속했고 수동 screenshot/tracing API는 호출하지 않았다.
- 새 페이지에 고정 HTML을 넣고 heading을 확인한 뒤 console에 `BIDFLOW_ARTIFACT_CONSOLE`을 남겼다. 요청을 abort하는 route와 요청 수 0 단언을 두고 마지막에 `BIDFLOW_EXPECTED_ARTIFACT_FAILURE` 오류를 던졌다. Vite·Spring·Cognito에 접속하지 않았다.

| 확인 대상 | 결과 |
|---|---|
| runner / reporter | 종료 1, 의도한 오류로 failed 1. passed/skip/flaky/retry 0 |
| 자동 실패 screenshot | PNG 1280 × 720. 실제 이미지를 열어 fixture heading과 “Not the BidFlow application” 문구 확인 |
| trace ZIP | 모든 ZIP entry 무결성 확인, trace 내 console 표식 1개와 의도한 오류 표식 확인 |
| 오류 문맥 | error-context.md에 같은 fixture heading 확인 |
| trace network | 기록 0개. 실제 HTTP/WS 통신 장애나 원장 상태는 검증하지 않음 |

runner가 단순히 nonzero라는 이유만으로 캡처 성공을 선언하지 않았다. 단일 사례·정확한 오류 표식·재시도 0·세 attachment·경로 범위·PNG 형식/크기·ZIP 무결성과 내부 표식을 함께 확인했다. 브라우저 준비 실패, 다른 오류, 파일 누락/손상은 이번 검증의 성공 조건이 아니다.

원본 PNG/ZIP/오류 문맥/reporter는 저장소 밖 보호된 임시 디렉터리에 두고 업로드하지 않았다. [구조화 증적](evidence/issue-020-failure-artifacts.json)에는 허용된 결과/크기/hash와 확인 여부만 남겼다. captureVerified=true와 businessFlowVerified=false를 분리했다.

## 같은 확인을 반복하는 방법

1. 새 외부 임시 디렉터리에 fixture와 임시 config를 만든다. 기존 결과 디렉터리나 실제 사용자 브라우저 상태는 재사용하지 않는다.
2. fixture는 새 page의 고정 HTML/console과 마지막 고정 오류만 사용한다. 네트워크를 차단하고 요청 0을 확인한다. 저장소의 기존 E2E 파일을 고의 실패하도록 수정하지 않는다.
3. 임시 config에서 원본 config를 절대경로로 import하고 testDir/testMatch/outputDir/JSON reporter/worker 1만 지정한다. trace/screenshot/retry 정책은 덮어쓰지 않는다.
4. 저장소에 설치된 Playwright CLI를 Node 24로 `test --config <임시-config>` 실행한다. 종료 1을 숨기지 말고, 정확히 의도한 오류인지 reporter와 artifact를 대조한다.
5. PNG를 실제 열어 확인하고 ZIP을 무결성 검사한다. trace의 console/오류 표식을 확인한다. 원문 artifact는 보호된 로컬 디렉터리에 유지하고 공유 전 별도 검토한다.

[Playwright 기록 옵션](https://playwright.dev/docs/test-use-options#recording-options)과 [Trace Viewer](https://playwright.dev/docs/trace-viewer)에서 캡처 정책과 로컬 확인 방법을 볼 수 있다. trace는 화면·요청·로그를 담을 수 있으므로 실제 업무 실행의 원문을 무검토로 커밋/업로드하지 않는다.

## 상태 보존과 한계

실행 전후 기존 API PID 30982·정확한 인자와 개발 컨테이너 ID가 같았고 사후 readiness UP이었다. API jar도 직전 #297 검증의 hash와 같았다. API/Clock 재시작·DB/Redis/볼륨/offset 초기화·AWS 작업은 없다.

이번에 증명한 것은 기존 실패 캡처 경로다. 실제 경매 실패 시 HTTP 응답·WebSocket eventId/version·runId SQL을 상관 추적하는 전체 진단 묶음이나 운영 장애 복구, AWS 실패 캡처를 검증한 것은 아니다. #20의 AWS 사용자 여정은 계속 별도 승인 대기다. 새 비즈니스 로직이 없으므로 기능 TDD 변경도 없다.

별도 기본 `make verify`는 Node 108개·Vitest 17파일/71개와 TypeScript/Vite build를 통과했다. backend unitTest/bootJar는 UP-TO-DATE였으며 전체 backend 통합이나 기존 기능 5개를 새로 실행한 결과는 아니다. 원본 임시 디렉터리는 OS 정리 대상이므로 장기 보존을 보장하지 않는다.
