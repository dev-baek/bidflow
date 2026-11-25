# Cognito 프런트엔드 로그인과 로컬 검증 사양

- 상태: 구현 병합(#326–#328), 실제 AWS 검증 대기. 기존 [#5](https://github.com/dev-baek/bidflow/issues/5)의 프런트엔드 범위다.
- 기반: [인증·인가 계약](issue-005-authentication.md), [#39 Cognito 설정](https://github.com/dev-baek/bidflow/issues/39), [#91 AWS 스모크](https://github.com/dev-baek/bidflow/issues/91).

현재 React에는 개발자 ID로 세션을 만드는 로컬 로그인만 있다. Spring Boot의 Cognito 검증은 그대로 두고, 프런트엔드에 로그인 왕복·세션 정리와 REST 및 STOMP의 Access Token 전달을 추가한다. AWS 계정을 연결하기 전에 로컬 대역으로 이 계약을 검증한다.

## S. 로그인과 세션 상태

`local`은 기존 개발자 ID 폼을 유지하고 `cognito`는 관리형 로그인 버튼만 제공한다. 상태는 미인증, 로그인 처리 중, 인증됨, 실패, 만료를 구분한다. 인증 콜백은 보호 화면과 분리하고, 성공하면 홈으로 이동한다. 취소·오류·만료는 안전한 고정 문구를 보여주고 로그인으로 돌아갈 수 있어야 한다. 돌아갈 URL을 요청 파라미터에서 받지 않는다.

로그아웃은 앱 세션과 실시간 연결을 우선 지운 뒤 Cognito [로그아웃 엔드포인트](https://docs.aws.amazon.com/cognito/latest/developerguide/logout-endpoint.html)에 사전 등록한 반환 URL을 전달한다. 로컬 모드에서는 외부 이동 없이 기존 방식으로 종료한다. 새로고침 시 세션 복원과 자동 갱신은 이번 범위에서 제외하며, 앱 세션이 없으면 다시 로그인한다.

## D. 세션 자료와 토큰 수명

- 로그인 왕복이 끝날 때까지 탭의 `sessionStorage`에는 무작위 `state`와 PKCE verifier, 만료 시각 등 일회성 거래 정보만 보관한다. 콜백에서는 원래 요청의 `state`·유효기간·설정 범위를 검증하고, 한 번 소비한 정보를 재사용하지 않는다. 콜백의 code·오류 파라미터는 주소창과 후속 탐색 기록에서 제거한다.
- Access Token과 만료 시각은 브라우저 메모리에만 둔다. 토큰 응답에 포함된 Refresh Token은 앱에 보관하거나 사용하지 않는다. ID Token은 REST·STOMP 인증에 전달하지 않는다. 화면용 사용자 식별은 인가 근거가 아니며 서버는 기존 서명·issuer·client·`token_use`·subject 검사를 유지한다.
- 로그아웃 또는 만료 이후에 들어온 교환 응답이나 이전 세션의 401이 현재 세션을 바꾸지 못하도록 요청의 세션 세대를 대조한다. 토큰·검증값·OAuth 원문 오류를 화면, 로그, URL 또는 지속 스토리지에 남기지 않는다.

## B. 인증 흐름과 전달 경계

1. 공개 App Client에서 [Authorization Code + PKCE S256](https://docs.aws.amazon.com/cognito/latest/developerguide/authorization-endpoint.html)을 사용한다. 검증값과 `state`는 Web Crypto로 만들고 비밀 키를 번들에 넣지 않는다. 기존 React 상태는 UI 전이에 사용하고 OAuth 처리와 네트워크 호출은 교체 가능한 인증 어댑터로 분리한다.
2. `state`가 유효한 콜백만 [토큰 교환](https://docs.aws.amazon.com/cognito/latest/developerguide/token-endpoint.html)으로 이어간다. 같은 code를 자동 재시도하지 않는다. 응답의 형식과 유효기간을 확인하고, 로그아웃·만료 시 재연결과 보호 요청을 중단한다.
3. 보호 REST와 STOMP CONNECT는 인증 방식에 따라 자격 증명 한 종류만 붙인다. `cognito`는 Bearer Access Token만 보내고 `X-Actor-Id`를 보내지 않는다. `local`은 기존 테스트 계약을 유지한다. 상품 등록·presign·입찰·본인 낙찰 조회를 확인하며, presigned 저장소 URL 및 임의 외부 주소에는 앱 토큰을 전송하지 않는다. REST 401은 해당 세션만 만료시키고, 403은 권한 오류로 처리한다.

## I. 실행 설정과 AWS 승인 경계

Cognito 모드에 필요한 공개 계약은 issuer URL, 관리형 로그인 HTTPS origin, client ID, 고정 콜백·로그아웃 반환 URL이다. 배포용 프로필은 설정이 없거나 잘못돼도 로컬 인증으로 내려가지 않는다. 로컬을 명시하는 개발·E2E 설정은 현재 동작을 유지한다. 정적 호스팅의 콜백 경로 직접 접근, App Client의 허용 반환 URL, 응답 헤더와 실제 브라우저 교환은 배포 시 별도로 확인한다.

계정 없이 프런트엔드 구현·로컬 대역·공개 설정 계약부터 검증한다. 실제 User Pool 및 App Client 생성은 #39, 실제 사용자 여정은 #91에서만 진행한다. 그 전에 계정·리전·예상 비용·삭제 계획을 보고하고 승인받는다.

## T. 실패 테스트부터 구현

| 구간 | 로컬 완료 기준 |
|---|---|
| 로그인 왕복 | S256과 반환 URL 확인. 일치하는 `state`에만 교환 1회. 불일치·누락·만료·재사용·OAuth 취소·교환 실패에서는 세션이 생기지 않는다. |
| 세션 상태 | 초기·처리 중·실패·성공·만료·로그아웃을 가짜 시계와 대역으로 재현한다. 지연된 성공/401은 다른 세션을 덮지 않는다. 새로고침 후 토큰 저장 흔적이 없다. |
| 전송 | 보호 REST/STOMP는 Access Token만 사용한다. 토큰 없음·만료·잘못된 설정은 차단되고, 공개 조회·외부 업로드에 자격 증명이 새지 않는다. 기존 로컬 개발자 로그인과 인수 테스트는 유지한다. |
| 검증 | Vitest 상태/어댑터·헤더 테스트, 로컬 콜백 흐름, `make verify`를 통과한다. 대역 통과는 실제 Cognito 또는 AWS 배포 통과로 기록하지 않는다. |

### 로컬 Chromium 재현

프런트엔드 의존성 설치 후 Chromium이 없다면 `npm --prefix apps/web exec -- playwright install chromium`을 실행한다. 저장소 루트에서 다음 명령을 실행한다.

```sh
npm --prefix apps/web run test:e2e -- --config playwright.cognito.config.ts
```

별도 localhost 포트 4175에서 배포용 프런트엔드 빌드를 띄운다. Playwright가 합성 로그인·API·STOMP 응답을 제공하므로 기존 로컬 E2E, 실행 중인 API, DB와 AWS 계정을 사용하지 않는다. 일치하는 콜백의 PKCE 교환, 공개 검색/상세의 토큰 제외, 보호 입찰·STOMP의 토큰 전달, 401 후 연결 종료, 불일치 콜백의 교환 차단을 검증한다. 실제 Cognito·ALB의 CORS·WebSocket 설정은 이 대역 검증의 범위가 아니다.
