# [Issue #39] Cognito 검증 환경 Terraform 사양

- 상태: #334 사양 병합. 이 문서는 [#39 Terraform 인증 구성](https://github.com/dev-baek/bidflow/issues/39)의 계약이며, 재현 명령은 [Terraform 검증 안내](../../infra/terraform/README.md#cognito-모의-검증)에 있다.
- 근거: [인증·인가](issue-005-authentication.md), [프런트엔드 인증·Chromium 대역](issue-005-cognito-frontend.md), [AWS 배포·삭제 Runbook](issue-017-aws-deployment.md).

React의 PKCE와 Spring Boot의 JWT 검증은 구현됐다. 검증 환경 Terraform에는 아직 User Pool, 브라우저용 App Client 및 로그인 도메인이 없고, 브라우저와 백엔드가 같은 풀을 쓰기 위한 공개 출력도 없다. 이번 범위는 이 연결 계약을 코드로 정의하고 실계정 없이 검사하는 데까지다.

## S. 검증용 로그인

기존 CloudFront 앱에서 로그인을 시작하고, Cognito Hosted UI(classic)를 거쳐 같은 CloudFront의 `/auth/callback`으로 돌아온다. 로그아웃 반환 경로는 `/login`이다. 사용자는 테스트 판매자와 구매자만 대상으로 하며 공개 회원가입은 차단한다. 테스트 사용자 생성·초기 비밀번호 전달은 #91의 승인된 운영 단계에서만 하고 Terraform 리소스·state에 넣지 않는다.

## D. 리소스와 공개 값

검증 전용 User Pool, App Client, Cognito 제공 prefix domain을 각각 하나만 정의한다. Lite와 classic UI를 명시하여 이번 검증에 불필요한 브랜딩·외부 IdP·사용자 지정 도메인을 도입하지 않는다. Lite에서 classic UI 사용이 가능하되 실제 비용은 별도 검토한다. [Cognito 인증 옵션](https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pools.html) · [Terraform 도메인 계약](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/cognito_user_pool_domain).

| 공개 출력 | 사용하는 곳 |
|---|---|
| User Pool issuer HTTPS URL | Vite `VITE_COGNITO_ISSUER`, Spring `BIDFLOW_COGNITO_ISSUER_URI` |
| App Client ID | Vite `VITE_COGNITO_CLIENT_ID`, Spring `BIDFLOW_COGNITO_CLIENT_ID` |
| Cognito 로그인 origin | Vite `VITE_COGNITO_ORIGIN`; issuer와 다른 값 |
| CloudFront의 정확한 콜백·로그아웃 반환 URL | `VITE_COGNITO_REDIRECT_URI`와 로그아웃 URL의 일치 확인 |

로그인 origin과 OIDC discovery/JWKS가 있는 issuer를 혼동하지 않는다. API·STOMP 주소는 기존 별도 배포 계약을 사용한다. 토큰, 사용자 비밀번호, 계정 자격 증명은 출력·로그에 넣지 않는다. [Cognito 도메인·discovery 설명](https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pools-assign-domain.html).

## B. App Client와 연결 경계

- 공개 Client이므로 Secret을 생성하지 않는다. OAuth grant는 Authorization Code만, scope는 기존 프런트엔드와 일치하는 `openid`만 허용한다. PKCE S256은 브라우저 구현의 계약이며, Terraform에 별도의 PKCE 강제 설정이 있다고 가정하지 않는다. [Cognito App Client 설정](https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-settings-client-apps.html).
- 콜백과 로그아웃 반환 URL은 기존 CloudFront 배포 origin에서 파생한 HTTPS 주소 한 개씩만 등록한다. 임의 origin, wildcard, localhost를 검증 Client에 넣지 않는다. [Cognito 로그아웃 계약](https://docs.aws.amazon.com/cognito/latest/developerguide/logout-endpoint.html).
- Spring Boot는 같은 issuer와 Client ID를 받아 기존 Access Token 검증을 사용한다. 이 이슈는 애플리케이션 시작 스크립트·TLS·CORS 정책을 바꾸지 않는다.

## I. 기본 비활성화와 AWS 승인

검증 루트에 기본값이 꺼진 명시적 활성화 스위치를 둔다. 비활성화 상태에서는 Cognito 리소스나 공개 설정을 생성하지 않으며, 활성화할 때만 유효한 도메인 prefix를 요구한다. 비밀이나 실제 사용자 데이터는 넣지 않는다. 검증 전용 풀은 전체 삭제가 가능해야 하며, 실제 삭제는 승인된 검증 환경의 리소스 목록을 대조한 뒤 Runbook에 따라 수행한다.

[#88](https://github.com/dev-baek/bidflow/issues/88)에서 공개 출력의 Vite/EC2 주입, ALB의 TLS 호스트명과 CloudFront origin의 REST CORS·STOMP 허용 설정, EC2의 issuer/JWKS 연결을 확인할 과제로 남긴다. 현재 REST CORS 구성은 로컬 전용이므로 CloudFront와 별도 origin의 ALB를 쓰는 경우 실제 브라우저 검증 전 해결해야 한다. [#91](https://github.com/dev-baek/bidflow/issues/91)은 실제 가입 차단·로그인·보호 REST·STOMP·로그아웃 및 삭제를 검증한다.

이번 사양과 후속 모의 테스트에는 AWS 접속 및 자격 증명이 필요 없다. 실제 `plan`, 리소스 생성 및 배포 전에 검증 계정·리전·실행 시간·10만 원 한도 내 예상 비용·삭제 계획을 보고하고 별도 승인을 받는다.

## T. 구현과 검증 순서

1. Terraform 모의 Provider에 대해 실패 테스트를 먼저 작성한다. 비활성화 시 리소스 0개 및 Cognito 출력 없음, 활성화 시 세 리소스, prefix 오류 거부, Secret 없음·code/PKCE 연결 계약, 정확한 두 반환 URL, issuer와 로그인 origin 분리를 확인한다. PKCE 자체는 기존 React 대역 테스트를 근거로 한다.
2. 모듈을 구현하고 `terraform fmt -check`, `terraform validate`, 모의 `terraform test`를 확인한다. 로컬 검증에서 원격 backend나 실계정 데이터 조회·apply를 실행하지 않는다.
3. 모의 결과는 실제 도메인 예약, Cognito 로그인, CORS, 인증서, 네트워크, 요금 또는 Destroy 통과로 기록하지 않는다. #39·#91의 실계정 확인은 승인 대기로 둔다.
