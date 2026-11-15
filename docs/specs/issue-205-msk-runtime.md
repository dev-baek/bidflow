# [Issue #205] MSK IAM 런타임 연결 사양

- 상태: 제안됨
- 관련 Issue: #205

## I. 연결 규칙

- `enable_managed_kafka=false`이면 runtime에 Kafka AWS bootstrap 값을 전달하지 않는다.
- true이면 MSK Serverless의 IAM SASL bootstrap broker만 root-owned 환경 파일에 넣는다.
- password와 access key는 사용하지 않으며 EC2 instance role의 MSK IAM 권한으로 인증한다.
- broker endpoint는 Browser, Terraform output의 민감 값, GitHub log에 노출하지 않는다.

## T. 검증

- false일 때 Kafka AWS 환경 변수가 없다.
- true일 때 `SASL_SSL`과 `AWS_MSK_IAM` 설정만 전달된다.
- Terraform validate와 계약 테스트를 통과한다.
