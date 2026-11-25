# [Issue #88] 검증 환경 인증 배포 연결 사양

- 상태: 검토 대기. [#88 배포 조립](https://github.com/dev-baek/bidflow/issues/88)의 인증 설정 범위다.
- 선행: [#39 Cognito Terraform 계약](issue-039-cognito-terraform-contract.md), [브라우저 인증 계약](issue-005-cognito-frontend.md), [AWS 배포·삭제 Runbook](issue-017-aws-deployment.md).

#335로 User Pool·App Client 정의와 공개 출력이 들어왔다. 하지만 현재 EC2 시작 템플릿은 그 출력을 주입하지 않고, REST CORS는 로컬 프로필에만 있다. CloudFront에서 실제 브라우저 인증을 확인하기 전에 같은 Cognito 값과 하나의 정확한 브라우저 origin을 두 실행 환경에 전달한다.

## S. 브라우저 요청 경로

기존 CloudFront는 Vite의 정적 파일을 제공한다. 브라우저는 Cognito 로그인 뒤 같은 CloudFront의 `/auth/callback`으로 돌아오고, REST와 STOMP는 별도 ALB 호스트에 직접 연결한다. CloudFront에 API 프록시를 추가하지 않는다. 인증서가 커버하고 ALB로 해석되는 승인된 API FQDN을 사용한다. ALB가 생성한 DNS 이름 자체를 사용자-facing URL로 가정하거나 TLS 검증을 끄지 않는다. [ALB TLS 인증서 계약](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/https-listener-certificates.html).

## D. 공개 설정 한 곳에서 파생

Terraform이 가진 Cognito 공개 값과 확인용 API FQDN·CloudFront 도메인으로 아래 두 설정을 만든다. API FQDN은 Cognito 활성화 시에만 필수이며, 포트·경로·쿼리·와일드카드·로컬 주소를 허용하지 않는다. 도메인과 인증서의 실제 연결 여부는 모의 테스트로 판정하지 않는다.

| 입력 | Vite 빌드 | EC2 Spring Boot |
|---|---|---|
| Cognito issuer와 Client ID | `VITE_COGNITO_ISSUER`, `VITE_COGNITO_CLIENT_ID` | `BIDFLOW_COGNITO_ISSUER_URI`, `BIDFLOW_COGNITO_CLIENT_ID` |
| Cognito 로그인 origin과 callback URL | `VITE_COGNITO_ORIGIN`, `VITE_COGNITO_REDIRECT_URI` | 주입하지 않음 |
| 승인된 API FQDN | `VITE_API_BASE_URL=https://<host>`, `VITE_WS_BASE_URL=wss://<host>` | 주입하지 않음 |
| CloudFront HTTPS origin | callback과 logout 반환 경로의 기준 | REST CORS와 STOMP의 동일 허용 origin |
| 실행 모드 | `VITE_AUTH_MODE=cognito` | `SPRING_PROFILES_ACTIVE=verification` |

브로커가 `/ws`를 붙이므로 WebSocket 기본 주소에는 경로를 넣지 않는다. Vite 값은 빌드 시 번들에 포함되는 공개 값이므로 필요한 키만 명시적으로 사용한다. 인증 정보가 누락되면 배포용 빌드 준비 단계에서 차단하고 로컬 로그인으로 대체하지 않는다. 토큰·비밀번호·Secret의 내용은 Vite, Terraform 출력, EC2 User Data에 넣지 않는다. [Vite 환경 변수 계약](https://vite.dev/guide/env-and-mode.html).

## B. Spring의 정확한 origin 경계

- `verification` 프로필에서 검증한 단일 HTTPS CloudFront origin을 REST와 WebSocket에 함께 사용한다. 누락·경로 포함·와일드카드·루프백·다중 origin은 거부한다. 로컬 프로필의 기존 origin과 개발자 ID 동작은 유지한다.
- REST는 `/api/v1/**`의 현재 화면 요청 `GET`·`POST`와 preflight만 이 origin에 허용한다. `Authorization`, `Content-Type`, `Idempotency-Key`를 허용하고 쿠키 기반 CORS 및 `X-Actor-Id`는 허용하지 않는다. `/api/internal/**`과 Actuator에 새 허용 규칙을 만들지 않는다.
- CORS preflight는 JWT 필터보다 먼저 평가해 토큰 없이 성공할 수 있다. 실제 보호 요청에 대한 JWT 검증과 소유권 인가는 그대로다. STOMP는 `/ws` 업그레이드의 origin을 검사하고, CONNECT에서 기존 토큰 검증을 계속한다. [Spring Security의 CORS 처리](https://docs.spring.io/spring-security/reference/servlet/integrations/cors.html).

## I. 설정 주입과 승인 경계

기존 EC2 템플릿에서 Terraform이 관리하는 공개 인증·origin·프로필 설정만 추가한다. 기존 Runtime Secret의 값이 이 키들을 덮을 수 없도록 충돌 시 시작 전에 중단한다. Cognito 기본 비활성화 동작, 기존 네트워크·IAM과 Secret 전달은 유지한다. 보안 그룹·NAT·DNS·ACM을 새로 생성하거나 변경하지 않는다.

실제 검증 전에는 API FQDN과 ACM 인증서 일치, ALB DNS 연결, private EC2의 HTTPS discovery/JWKS 접근을 확인한다. 로컬 테스트로 이 조건이나 실제 Cognito 로그인, CloudFront callback 라우팅을 통과했다고 표시하지 않는다. 별도로 현재 이미지 저장소 어댑터는 로컬 S3 호환 credentials 설정을 사용한다. **S3 직접 PUT의 IAM·CORS·presign은 이 사양 범위가 아니며**, 전체 상품 등록 Smoke 전 #88·[#91](https://github.com/dev-baek/bidflow/issues/91)에서 별도 검증한다.

## T. 구현 순서와 통과 기준

1. Terraform 모의 테스트와 배포 입력 단위 테스트부터 작성한다. Cognito 꺼짐 상태가 기존 배포를 바꾸지 않는지, 켜졌을 때 URL 누락과 불허 입력을 거부하고 두 실행 환경에 동일 issuer·Client ID를 쓰는지 확인한다. Runtime Secret 충돌 시 중단, Vite가 공개 키만 쓰고 `/ws`를 중복하지 않는 것도 확인한다.
2. Spring HTTP 테스트에서 허용 origin의 preflight와 인증 없는 보호 요청의 거부를 각각 확인한다. 다른 origin·`X-Actor-Id`·내부 경로는 브라우저 허용 헤더를 얻지 못해야 한다. WebSocket은 허용·비허용 origin 및 CONNECT JWT의 기존 계약을 검사한다. 로컬 계정 대역 회귀를 유지한다.
3. 위 로컬 검사와 `make verify` 후 #91의 실제 로그인·공개 조회·보호 입찰·연결·로그아웃을 별도 승인으로 실행한다. 사용자에게 검증 계정·리전·예산과 삭제 계획을 보고하기 전에는 실제 AWS Plan/Apply, 리소스 생성 또는 조회를 실행하지 않는다.
