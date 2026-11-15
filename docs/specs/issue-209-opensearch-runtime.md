# [Issue #209] OpenSearch 런타임 연결 사양

- 상태: 제안됨
- 관련 Issue: #209

## I. 연결 규칙

- `enable_managed_search=false`이면 OpenSearch AWS endpoint를 runtime에 전달하지 않는다.
- true이면 private HTTPS endpoint만 root-owned 환경 파일에 전달한다.
- EC2 application role은 해당 domain의 `es:ESHttp*`만 허용하며 Browser에는 endpoint를 노출하지 않는다.
- password와 access key는 만들지 않는다.

## T. 검증

- false일 때 OpenSearch AWS 환경 변수가 없다.
- true일 때 HTTPS endpoint와 resource-scoped IAM 정책만 존재한다.
- Terraform validate와 계약 테스트를 통과한다.
