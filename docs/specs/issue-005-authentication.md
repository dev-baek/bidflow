# [Issue #38] Cognito 인증·인가 S/D/B/I/T 사양

- 상태: 제안됨
- 관련 Issue: [#38 Cognito 인증·인가 S/D/B/I/T 사양 작성](https://github.com/dev-baek/bidflow/issues/38)
- 후속 구현: #39 Cognito User Pool·App Client, #40 Spring Security JWT·소유권 인가, #41 로그인·로그아웃 화면
- 관련 문서: [Architecture](issue-002-architecture-adr.md), [상품 등록 사양](issue-046-listing-registration.md), [WebSocket 사양](issue-014-realtime-websocket.md)

## 1. 결정

BidFlow의 사용자 인증 원본은 AWS Cognito이며, Spring Boot는 Cognito **Access Token**을 검증하는 OAuth2 Resource Server다. 애플리케이션은 비밀번호, Refresh Token, Cognito Client Secret을 저장하거나 Browser에 전달하지 않는다.

로컬 개발은 Cognito 계정을 만들지 않아도 기능을 검증할 수 있도록 `local` profile의 `X-Actor-Id` Adapter를 허용한다. 이 Adapter는 `production`/`verification` profile에서 등록되지 않으며, ALB 뒤 AWS Runtime에서는 Header로 사용자를 위조할 수 없어야 한다.

## 2. S. 화면·사용자 흐름

| 화면/흐름 | 정상 상태 | 실패/경계 상태 |
|---|---|---|
| 로그인 | Browser가 Cognito Hosted UI 또는 OIDC Authorization Code + PKCE로 이동 | 취소·인증 실패 시 로그인 화면으로 복귀, Token 값을 화면/URL/Log에 노출하지 않음 |
| 세션 복원 | 유효 Access Token으로 보호 API와 WebSocket 연결 | 만료/검증 실패 시 local session을 지우고 로그인 유도 |
| 상품 등록 | 인증된 `sub`가 판매자로 저장 | Token 없음/만료는 401, 입력한 sellerId는 무시 |
| 상품 변경/취소 | 저장된 `seller_id`와 현재 `sub`가 같음 | 다른 판매자는 403, 대상 상품 없음은 404 |
| 입찰 | 인증된 `sub`가 bidder로 기록 | Token 없음은 401, Body/Header의 bidderId는 신뢰하지 않음 |
| WebSocket | STOMP `CONNECT`의 Bearer Access Token으로 Principal 생성 | Token 없음·형식 오류·만료·ID Token은 연결 거부 |

MVP는 Admin/Guest 같은 일반 RBAC 화면을 만들지 않는다. 판매자·입찰자 권한은 역할 문자열이 아니라 **리소스 소유자 여부와 인증된 subject**로 결정한다. 별도 운영자 권한이 필요해질 때만 Cognito Group과 명시적 Authorization Policy를 추가한다.

## 3. D. 사용자 식별자와 Token 데이터

| 항목 | 원본/저장 위치 | 사용 규칙 |
|---|---|---|
| 사용자 ID | Cognito Access Token `sub` | PostgreSQL `seller_id`, `bidder_id`, Owner 비교의 유일한 사용자 식별자 |
| Access Token | Browser 메모리 또는 보안 세션 전략 | API `Authorization: Bearer`와 STOMP `CONNECT` Header에만 전달 |
| ID Token | Browser의 표시용 기본 프로필 정보 | API·WebSocket 인가에 사용하지 않음 |
| Refresh Token | Cognito/OIDC client session | Spring Boot API, Log, DB에 저장하지 않음 |
| Cognito Client Secret | Secrets Manager/서버 전용 설정 | Vite `VITE_` 변수·Repository·Browser에 절대 노출하지 않음 |
| 로컬 actor ID | `local` profile의 요청 Header | 테스트·로컬 Docker 전용, DB에는 Cognito `sub`와 같은 문자열 형태로만 저장 |

PostgreSQL은 Cognito subject 참조만 보관한다. 이메일, 비밀번호, raw JWT, Refresh Token은 거래 원장·Outbox Event·Consumer Log·OpenSearch 문서에 넣지 않는다.

### 3.1 Access Token 검증 계약

Spring Security는 다음을 모두 만족한 Token만 인증한다.

1. Cognito User Pool issuer와 정확히 일치하는 `iss`
2. JWKS 공개키로 검증된 서명과 유효 시간(`exp`, `nbf`)
3. `token_use=access`
4. 이 App Client의 `client_id`
5. 비어 있지 않은 `sub`

Access Token에는 일반 OIDC `aud` Claim이 없을 수 있으므로, Cognito Access Token의 Client binding은 `client_id`로 검증한다. JWT Decoder의 기본 issuer/서명 검증만으로 `token_use`와 `client_id` 검증이 생략되어서는 안 된다.

## 4. B. Spring Boot 인가 경계

### 4.1 REST

```text
Browser Authorization: Bearer Access Token
        ↓
Spring Security JwtDecoder + Cognito validator
        ↓
Authentication principal = JWT sub
        ↓
Controller/Use case receives AuthenticatedActor(sub)
        ↓
Ownership Policy compares sub with persisted seller_id
```

- `/actuator/health/**`와 읽기 전용 상품 검색은 anonymous 접근을 허용한다.
- 상품 등록, 이미지 presign, 상품 변경/취소, 입찰 접수, 내 경매 조회, 재색인은 인증을 요구한다.
- Controller는 `X-Actor-Id`, `sellerId`, `bidderId`를 외부 입력으로 받지 않는다. Actor는 Security Context Adapter에서만 얻는다.
- Use case는 `AuthenticatedActor`를 명시적 입력으로 받고, 소유권 비교는 순수 함수/Policy로 둔다.
- 존재하지 않는 리소스는 404, 존재하지만 소유자가 아닌 변경 요청은 403이다. 사용자 존재 여부를 Token 오류로 추측할 수 없어야 한다.

### 4.2 WebSocket

- STOMP `CONNECT` Header: `Authorization: Bearer <access-token>`
- 같은 `JwtDecoder`와 Access Token validator를 사용해 `sub` Principal을 만든다.
- 연결 이후 client가 보내는 `userId`, `recipientId`, `sellerId` Header는 인가 근거로 사용하지 않는다.
- Redis Pub/Sub은 전달 수단일 뿐 인가가 아니다. 수신 대상은 인증된 Principal과 서버가 만든 `RealtimeMessage.recipientId`를 비교해 결정한다.

### 4.3 오류 계약

| 조건 | REST | WebSocket |
|---|---|---|
| Authorization Header 없음 | 401, `UNAUTHENTICATED` | CONNECT 거부 |
| Bearer 형식 오류·만료·서명/issuer/client 불일치·ID Token | 401, `INVALID_ACCESS_TOKEN` | CONNECT 거부, Token 내용을 error/log에 포함하지 않음 |
| 인증됐지만 소유자 아님 | 403, `FORBIDDEN` | 서버가 해당 사용자 대상 메시지를 전송하지 않음 |
| 대상 없음 | 404, `NOT_FOUND` | 구독/조회 결과 없음 |
| local 외 profile의 `X-Actor-Id` | Header는 인증 효과 없음, 401 | 적용하지 않음 |

구조화 로그에는 `correlationId`, HTTP status, 안전한 resource ID만 남긴다. Authorization Header, Cookie, JWT Claim 전체, 이메일은 기록하지 않는다.

## 5. I. Cognito와 배포 환경

### 5.1 로컬

- `local` profile은 명시적으로 켠 경우에만 `X-Actor-Id` Adapter를 등록한다.
- 기본/verification/production profile은 Cognito issuer URI와 App Client ID가 없으면 보호 API를 시작하지 않거나 fail closed로 동작한다.
- Test용 JWT Decoder는 공개키 검증을 우회하는 production Bean이 아니라 Test Configuration에서만 사용한다.

### 5.2 AWS 검증 환경

- #39가 검증 전용 Cognito User Pool, App Client, Hosted UI redirect URI를 Terraform으로 만든다.
- User Pool ID, issuer URI, client ID는 public configuration일 수 있지만 Client Secret은 Secrets Manager에만 둔다.
- ALB는 HTTPS 종료를 담당하고 Spring Boot는 Bearer Token을 직접 검증한다. ALB Header를 사용자 인증의 원본으로 신뢰하지 않는다.
- 실제 Cognito User Pool 생성은 AWS 계정·권한을 받은 뒤에만 한다. 현재는 Terraform·Spring Security 코드와 local test로 계약을 검증한다.

## 6. T. 테스트 기준

| 구분 | 시나리오 | 기대 결과 |
|---|---|---|
| Unit | Access Token validator | `token_use=access`, 허용 client ID, `sub`만 인증 |
| Unit | ID Token·잘못된 client ID | 인증 거부 |
| MVC/Security | Header 없음·만료·변조·issuer 불일치 | 401, 안전한 오류 코드 |
| MVC/Security | 인증된 본인/타인 변경 | 본인 성공, 타인 403, 없는 리소스 404 |
| MVC/Security | local profile Header Adapter | local에서만 actor 생성, verification/production은 무시/거부 |
| WebSocket | Access Token CONNECT | `sub` Principal 생성 |
| WebSocket | ID Token·누락·만료 CONNECT | 연결 거부, Token 노출 없음 |
| Regression | 로그 capture | Authorization/Cookie/raw JWT/이메일 미포함 |
| AWS smoke | 실제 Cognito JWT | issuer·client·WebSocket 연결이 #91에서 검증됨 |

## 7. 완료 조건

- [x] Cognito Access Token, subject, local actor Header의 책임 경계를 정의했다.
- [x] REST·WebSocket의 JWT 검증·소유권 인가·401/403/404 계약을 정의했다.
- [x] Token/Secret/개인정보의 저장·로그 금지 규칙을 정의했다.
- [x] #39 AWS 구성과 #40 Spring Security 구현의 분리 기준을 정의했다.
- [x] TDD 및 AWS smoke test의 검증 기준을 정의했다.

## 8. 근거

- [Amazon Cognito JWT 검증](https://docs.aws.amazon.com/cognito/latest/developerguide/amazon-cognito-user-pools-using-tokens-verifying-a-jwt.html): Access Token의 `client_id`, `token_use`, issuer, 만료 검증
- [Amazon Cognito Access Token claim](https://docs.aws.amazon.com/cognito/latest/developerguide/amazon-cognito-user-pools-using-the-access-token.html): 사용자 식별자로서 `sub`와 Access Token 서명 검증
