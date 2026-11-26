# [Issue #354] 검증 배포 산출물과 입력 사전 점검

- 작업 이슈: [#354 산출물·입력 점검](https://github.com/dev-baek/bidflow/issues/354), 상위 [#88 배포 구성](https://github.com/dev-baek/bidflow/issues/88).
- 선행: [첫 배포 순서와 공통 입력](issue-088-first-deployment.md), [AWS 배포·삭제 Runbook](issue-017-aws-deployment.md).
- 이 사양은 AWS 접근이나 비용을 승인하지 않는다. 승인 요청은 [#355](https://github.com/dev-baek/bidflow/issues/355), 실제 게시·배포는 [#356](https://github.com/dev-baek/bidflow/issues/356), 삭제는 [#357](https://github.com/dev-baek/bidflow/issues/357)에서 추적한다.

## S. 운영자 순서

승인 전에는 배포할 커밋에서 ARM64 이미지와 가짜 공개 설정을 넣은 웹 빌드를 검증한다. 승인 뒤에만 EC2를 보류한 검증 환경의 ECR·CloudFront 공개 출력을 사용해 배포 산출물을 확정한다. 로컬 가짜 설정을 포함한 웹 번들을 올리지 않는다. 이 작업에서 서버를 기동하거나 새 배포 워크플로를 만들지 않는다.

## D. 입력과 실패 조건

| 영역 | 필수 확인 | 중단 조건 |
|---|---|---|
| 소스 | 정리된 전용 작업 트리와 전체 commit SHA. 앱과 웹 산출물이 같은 커밋인지 확인 | 수정·미추적 파일, 커밋 불일치 |
| EC2 AMI | 승인 계정의 도쿄 ARM64 AMI. Docker 기동, AWS CLI v2, jq, SSM Agent 준비와 SSM 등록 방식 확인 | AMI·리전·아키텍처 불일치, 필수 도구 미확인 |
| API | `verification_api_fqdn`이 도쿄 ALB의 ACM 인증서로 검증되는 이름이고, 승인된 DNS가 해당 ALB를 가리킴 | ALB 기본 DNS명을 API FQDN으로 사용, 인증서 불일치·미발급, 잘못된 DNS |
| 웹 | `verification_web_build_env`의 공개 값만 사용. API HTTPS/WSS 주소와 CloudFront Cognito 콜백 일치, 정적 웹 전용 private S3 버킷·release prefix 확인 | 전체 state 또는 Secret 사용, 이미지 버킷 선택, 잘못된 콜백·prefix |
| Runtime Secret | Docker env-file 형식 Secret의 ARN만 제공. #88의 관리 설정을 덮어쓰지 않음 | 토큰·비밀번호 원문을 입력 파일·Git·로그에 전달 |

## B. AWS 없이 준비

### 백엔드 이미지

Docker 엔진이 실행 중인 환경의 깨끗한 저장소 루트에서 실행한다. 실패 시 다음 단계로 가지 않는다. 이 명령은 public base image와 빌드 의존성을 받을 수 있지만 AWS 계정이나 ECR은 사용하지 않는다.

```bash
set -e
test -z "$(git status --porcelain)"
revision=$(git rev-parse HEAD)
image="bidflow-verification:$revision"
docker buildx build --platform linux/arm64 --load \
  --label "org.opencontainers.image.revision=$revision" --tag "$image" .
details=$(docker image inspect --format '{{.Os}}/{{.Architecture}} {{index .Config.Labels "org.opencontainers.image.revision"}}' "$image")
test "$details" = "linux/arm64 $revision"
```

로컬 image ID와 ECR manifest digest는 다른 값이다. 로컬 빌드는 아키텍처와 커밋을 확인한 증적이지 게시 증적이 아니다. [Docker Buildx 플랫폼과 로컬 로드](https://docs.docker.com/reference/cli/docker/buildx/build/)

### Vite 웹

Node 24에서 lockfile 기준으로 설치한다. 저장소 밖의 파일에 공개 설정 7개만 준비한다. 승인 전에는 테스트 전용 주소와 ID를 사용한다.

```bash
set -e
npm --prefix apps/web ci
node scripts/build-verification-web.mjs /safe/path/verification-web-public.json
test -s apps/web/dist/index.html
```

HTML의 JS·CSS 참조 파일이 `dist` 안에 모두 있고 비어 있지 않아야 한다. 누락·잘못된 주소·추가 입력이 거부되는지 기존 [웹 빌드 설정 테스트](../../tests/scripts/verification-auth-build.test.mjs)로 확인한다. 이전 `dist`가 있어도 빌드가 실패하면 게시하지 않는다.

## I. 승인 후 게시 기준

1. EC2를 보류한 채 검증 ECR과 정적 웹 S3·CloudFront를 준비한다. 승인된 게시 주체만 ECR에 커밋 태그를 게시한다. ECR이 반환한 digest를 해당 저장소에서 조회한 뒤 `repository@sha256:…`로 다시 확인하고, 아키텍처·revision label이 일치할 때만 `application_image`로 사용한다. 태그·다른 저장소·로컬 image ID는 금지한다. [ECR digest 조회](https://docs.aws.amazon.com/cli/latest/reference/ecr/describe-images.html)
2. 새 환경의 공개 출력으로 웹을 다시 빌드한다. `dist`의 내용물을 웹 전용 S3의 새 `releases/<release-id>/` 아래에 올리고, 배포 전 파일 목록·크기·태그/커밋 기록을 대조한다. 빈 prefix나 기존 release를 덮어쓰지 않는다. 이 업로드에는 public ACL이 필요하지 않다.
3. 전체 파일이 준비된 뒤에만 CloudFront 원본 경로에 같은 값을 `web_asset_prefix`로 반영한다. 별도 승인된 배포에서 캐시 전환 후 `/`와 `/auth/callback`, 실제 JS/CSS 응답과 콘텐츠 유형을 확인한다. SPA fallback 때문에 JS 경로가 HTML 200을 돌려줘도 성공이 아니다. 전환에 실패하면 이전 release를 보존하고 복구 여부를 판단한다. [CloudFront 캐시 정책](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/using-managed-cache-policies.html)

## T. 완료 증적

- #354: ARM64 빌드·메타데이터와 가짜 공개 입력의 웹 빌드·잘못된 입력의 중단을 로컬에서 확인한다. 엔진이 꺼져 있으면 백엔드는 미실행으로 남긴다.
- #356: 실제 게시 digest, CloudFront 정적 산출물, AMI·DNS·TLS 및 readiness를 승인된 실행에서 확인한다. 공개 보고서에는 commit SHA, 산출물 해시와 확인 여부만 남기고 입력 파일·자격 증명·state를 올리지 않는다.
