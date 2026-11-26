# [Issue #88] 사설 OpenSearch 검색·색인 연결 계약

- 상태: 제안. AWS 접속·비용·리소스 변경을 승인하지 않는다.
- 작업 이슈: [#88 배포 구성](https://github.com/dev-baek/bidflow/issues/88). [#89](https://github.com/dev-baek/bidflow/issues/89)의 도메인 생성 모듈은 재사용한다. 실제 색인·검색·정리는 [#91](https://github.com/dev-baek/bidflow/issues/91)에서 검증한다.
- 선행: [OpenSearch 검증 모듈](issue-197-opensearch-verification.md), [첫 배포 순서](issue-088-first-deployment.md), [MSK 연결](issue-088-msk-runtime.md).

## 문제

Terraform은 사설 HTTPS 도메인 주소를 EC2에 전달하지만, 현재 검색·색인 어댑터는 로컬 OpenSearch처럼 서명 없는 요청을 전송한다. IAM으로 제한한 도메인에서는 이 요청이 권한을 얻지 못한다. 또한 앱 역할은 현재 도메인 경로 전체의 여러 HTTP 메서드를 허용하지만 실제 호출은 두 경로뿐이다.

## S. 사용자와 운영자 흐름

- 기존 상품 검색 화면·API·필터·페이지네이션을 유지한다. 브라우저는 앱 API만 호출하며 OpenSearch 주소나 권한 정보를 받지 않는다.
- #91에서는 EC2를 보류한 첫 단계에 OpenSearch를 명시적으로 켜고, 승인된 VPC 운영 역할로 매핑과 읽기·쓰기 alias를 준비한다. 그 뒤 EC2를 활성화해 상품 등록의 이벤트 → 색인 → 검색 노출을 확인한다. 색인 생성 자체를 앱 정상 기동이나 상품 검색 성공으로 보고하지 않는다.
- OpenSearch 권한 오류·연결 실패는 검색 503과 색인 재처리/DLT로 관찰한다. PostgreSQL 원장이나 로컬 OpenSearch로 몰래 대체하지 않는다.

## D. 인덱스와 자격 증명

| 항목 | 계약 |
|---|---|
| 원본 | 상품과 경매 상태의 원본은 PostgreSQL이며 OpenSearch는 기존 Kafka 이벤트와 DB 자료로 재구성 가능한 읽기 모델이다. |
| 초기 매핑·alias | 기존 `infra/opensearch/products-v1.json`, `products-aliases.json`을 사용한다. 두 alias가 같은 검증 인덱스를 가리키고 쓰기 alias가 write index로 선택됐는지 확인한다. 기존 매핑·alias가 다르면 운영자가 중단하고 확인한다. |
| 앱 자격 증명 | AWS SDK의 `InstanceProfileCredentialsProvider`를 사용해 EC2 역할의 갱신 가능한 임시 credentials만 읽는다. 기본 프로파일 키, 사용자명·비밀번호, 인증 헤더·세션 토큰을 저장소·Runtime Secret·User Data·공개 보고서에 넣지 않는다. |

## B. 런타임 계약

- 관리형 모드를 명시적으로 선택한 경우에만 AWS SDK v2의 SigV4를 사용한다. 서비스는 도메인형 OpenSearch Service인 `es`, 리전은 검증 리전, 대상은 Terraform이 전달한 사설 HTTPS 도메인으로 고정한다. 주소·리전이 없거나 안전하지 않으면 초기화에 실패하고 서명 없는 로컬 요청을 대신 보내지 않는다. 기존 로컬 주소·HTTP 방식은 유지한다. [AWS OpenSearch 요청 서명 가이드](https://docs.aws.amazon.com/opensearch-service/latest/developerguide/managedomains-signing-service-requests.html).
- 두 어댑터의 HTTP 전송 경계에서만 서명·전송을 공유한다. OpenSearch DSL, JSON 본문, 경로, 페이지네이션, 기존 재시도/실패 계약은 유지한다. 검색 POST 필터는 URL 파라미터로 옮기지 않는다. 쓰기 alias 사용을 강제해 준비 누락을 같은 이름의 물리 인덱스 자동 생성으로 숨기지 않는다. [OpenSearch 2.19 문서 쓰기의 alias 요구 옵션](https://docs.opensearch.org/2.19/api-reference/document-apis/index-document/).
- 서명과 전송에 같은 본문 바이트를 사용한다. 서명한 요청을 리다이렉트하거나 미서명으로 재시도하지 않는다. 로그는 오류 분류·HTTP 상태 정도만 제공하며 서명·토큰·임의 응답 본문을 노출하지 않는다.

## I. 배포와 최소 권한

- OpenSearch와 EC2가 둘 다 켜졌을 때만 실제 도메인 ARN을 참조한 앱 정책을 붙인다. 생성 여부는 스위치로 결정해 ARN이 미정이어도 Plan이 가능해야 한다. EC2 부팅 전에 정책이 연결돼야 한다.
- 읽기는 `es:ESHttpPost`의 `/bidflow-products-read/_search`, 쓰기는 `es:ESHttpPut`의 `/bidflow-products-write/_doc/*` 경로만 허용한다. 앱 역할에 `_aliases`, 도메인 관리·삭제, 물리 인덱스 일괄 권한을 주지 않는다. VPC 접근만으로 허용되는 익명 도메인 정책을 추가하지 않는다. [OpenSearch IAM과 URI 권한](https://docs.aws.amazon.com/opensearch-service/latest/developerguide/ac.html).
- EC2는 관리형 검색용 모드·endpoint·리전만 받고, 컨테이너의 역할 사용을 위해 기존 IMDSv2 응답 hop limit 2 경로에 OpenSearch를 추가한다. MSK·Cognito가 꺼져 있어도 Runtime Secret이 검색·AWS 자격 증명 설정을 덮어쓸 수 없게 한다. 기존 사설 네트워크·TLS 설정을 유지한다.
- #91의 별도 운영 역할이 준비 작업에 필요한 검증 도메인 경로만 사용한다. 앱 IAM으로 매핑이나 alias를 만들지 않으며, 운영자 클라이언트·AWS 접근·생성·삭제 자동화는 이 구현 범위에 넣지 않는다.

## T. 구현 전 실패 테스트와 완료 기준

1. 서명하지 않는 기존 요청을 대역에서 재현하고, 고정 시각·테스트 세션 자격 증명으로 두 요청의 메서드·대상·본문·서명 scope를 확인한다. 잘못된 destination, 미설정·권한 실패, 로그의 민감 값 차단과 로컬 회귀를 검사한다.
2. Terraform 모의 테스트로 비활성화·EC2 보류·ARN 미정 상태, 정확한 두 권한, 환경 설정 주입과 충돌 차단, IMDSv2 토큰·hop limit을 확인한다. 기존 S3·MSK 회귀를 유지한다.
3. #91에서만 실제 서명 성공, 익명 요청 및 허용되지 않은 index 관리 요청의 거부, 상품 색인과 검색 결과, 검증 도메인 삭제를 확인한다. 모의 테스트를 실배포나 비용 측정 증적으로 삼지 않는다.
