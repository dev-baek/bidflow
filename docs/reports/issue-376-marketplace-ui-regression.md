# 경매 마켓 UI 로컬 통합 검증 (#376)

검증 기준: #368의 개정 사양과 #401까지 병합된 화면. UI 합성 데이터와 실제 로컬 서비스 검증을 분리했다. 운영 데이터·AWS 리소스·Cognito 실계정은 사용하지 않았다.

## 화면과 접근성

- Chromium 320·390·768·1280px에서 홈, 검색, 상세, 로그인, 출품, 앱 404를 확인했다. 가로 넘침이 없고, 좁은 화면에서는 사진 뒤에 거래 정보, 넓은 화면에서는 사진 오른쪽에 거래 정보가 배치된다.
- 검색·필터·썸네일에서 Tab/Shift+Tab과 Enter/Space를 검증했다. 주요 검색 버튼은 44px 이상이며, 포커스가 실제로 보이고 다른 요소에 가려지지 않는지 확인했다. 잘못된 출품을 시도하면 첫 오류인 사진 선택에 포커스가 이동하고, 각 입력은 자기 오류 문구와 연결된다.
- 검색 빈 결과/일시 실패/재시도, 상세 없음/조회 실패를 구분한다. 초기 설정 오류와 로그인/콜백 경계는 각각 Vitest와 Cognito 모의 브라우저 테스트를 사용한다.
- 전역 링크의 색과 포커스를 공통 토큰으로 통일하고 더 이상 쓰지 않는 카드·폼 스타일을 제거했다. 스크립트는 토큰 중복, 화면 스타일의 직접 색상 값, 텍스트·경계·포커스 대비 기준을 확인한다. 이 검증은 전수 접근성 인증이나 스크린리더 실기기 테스트를 의미하지 않는다.
- 실제 UI에 합성 사진·시각을 사용한 캡처: [390px](../design-previews/marketplace/issue-376-390.jpg), [1280px](../design-previews/marketplace/issue-376-1280.jpg). 두 화면은 같은 상품의 사진과 가격·마감·입찰 영역을 보여준다.

## 같은 경매에서 확인한 실제 로컬 흐름

격리한 Docker 환경에서 PostgreSQL, Kafka, Redis, OpenSearch와 비공개 SeaweedFS를 사용했다. 합성 JPEG를 판매자가 업로드하고, 목록과 상세에서 같은 경매의 대표 사진과 출품 사진을 실제로 읽어 브라우저가 디코딩하는지 확인했다. 카테고리·키워드·정렬과 뒤로가기 복원도 검증했다.

이 경매를 별도 구매자 세션에서 열어 현재가 10,000원과 마감 시각을 확인하고, 직접 입찰 12,000원을 확인 후 제출했다. 승인, 공개 가격 변경, 종료 후 공개 낙찰가와 본인 낙찰을 검증했다. 별도 시나리오에서 유찰, 자동 입찰의 5분 마감 연장, 직접 입찰 재시도에 따른 멱등성 및 WebSocket 재연결 후 가격 복구를 검증했다.

## 다시 실행하기

- 저장소 루트: `make verify` (백엔드 단위 테스트, 프런트 137개, 스크립트 158개, 빌드). 브라우저 테스트는 아래처럼 별도로 실행한다.
- `apps/web`: `npm run test:e2e:ui` (합성 화면 테스트 5개, 서버는 명령이 시작한다). 자동 실패 스크린샷·trace는 `test-results-ui/`, HTML 보고서는 `playwright-report-ui/`에 보관한다. 실패한 테스트의 `trace.zip`은 `npx playwright show-trace <trace.zip 경로>`로 로컬에서 확인한다. [실패 증적 검증](issue-020-failure-artifacts.md#반응형-ui-테스트의-실패-증적)
- GitHub Verify: `make verify` 통과 후 [Chromium headless shell과 Linux 의존성](https://playwright.dev/docs/browsers)을 설치해 같은 합성 UI 테스트를 실행한다. CI에서는 로그로 결과를 확인하며 스크린샷·trace·HTML 보고서는 업로드하지 않는다. 실제 API·Cognito를 연결하는 E2E는 이 워크플로에 포함하지 않는다.
- `apps/web`: `npm run test:e2e -- --config playwright.cognito.config.ts` (실제 Cognito를 호출하지 않는 모의 인증 2개).
- [로컬 검색 환경 실행 순서](issue-099-playwright-e2e.md)에 따라 서버를 준비한 뒤 `apps/web`에서 핵심 흐름 5개를 실행한다. 로컬 테스트 Clock을 공유하므로 한 워커로 실행한다.

```sh
BIDFLOW_E2E_BASE_URL=http://127.0.0.1:5173 BIDFLOW_E2E_SEARCH=1 npm run test:e2e -- --workers 1 --grep '공개 유찰|자동 입찰로 확정|직접 입찰 재시도는|WebSocket 연결을 복구|실제 사진으로 출품'
```

입찰 지연·부하 테스트와 실제 AWS 배포/인증(#356)은 이번 검증 범위가 아니다.
