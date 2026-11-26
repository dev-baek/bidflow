# [Issue #354] 로컬 배포 산출물 검증

- 작업: [#354 배포 사전 점검](https://github.com/dev-baek/bidflow/issues/354), [산출물 사양](../specs/issue-354-deployment-artifacts.md).
- 검증 대상: `main`의 `de9db0f834f3bf15c8c9d11ac40520d0c44b5dfb`, Git tree `f7bff3cf6cb9dd656ce4a5f8638e389859d22603`. 사용자의 작업 트리는 변경하지 않았다.
- 환경: Apple Silicon, Docker Desktop Linux/ARM64, Node 24. AWS 계정·원격 state·ECR/S3에 접근하지 않았다.

## ARM64 이미지 확인

- 원본 커밋의 Git tree와 일치하는 별도 소스에서 기존 Dockerfile을 `docker buildx build --platform linux/arm64 --load`로 빌드했다. Gradle `:runtime:bootJar`가 성공했다.
- Docker inspect에서 `linux/arm64`, 위 커밋과 동일한 OCI revision 라벨, 런타임 사용자 `bidflow`를 확인했다.
- 네트워크를 끈 임시 컨테이너에서 Temurin Java 21.0.13, `aarch64`, 비root UID 999, 비어 있지 않은 `/opt/bidflow/app.jar`를 확인했다.
- Docker 로컬 이미지 ID: `sha256:f72f4878c9b05383d824d5d25f560a5c165cbf2b0c3e54b88035c628059ab829`. ECR에서 조회한 게시 digest가 아니므로 배포 입력에 사용하지 않는다. Spring 애플리케이션과 의존 서비스는 이 검사에서 기동하지 않았다.

## Vite 확인

가짜 공개 설정으로 기존 검증 모드 빌드를 실행했다. HTML과 HTML이 참조한 JS·CSS가 존재하고, 테스트 전용 API 주소·공개 Client ID가 번들에 들어가는 것을 확인했다. 미설정·추가 키·HTTPS/WSS 불일치에서는 종료 코드 1을 반환했고, 아래 산출물 세 파일의 해시는 그대로였다. 별도 설정·가드 테스트 5개도 통과했다.

| 파일 | SHA-256 |
|---|---|
| `index.html` | `986359a936e0c626eb82ceda921edbd77df152ba590a7f00ae5d630727baa51b` |
| `assets/index-Dpbf-8f_.js` | `82d487a24a9d8eae77a8acf2c22fd25474f9eca93b20658a90864bd64fb02e09` |
| `assets/index-VwrQmCo.css` | `41b95163a51ff459e91a2232a7dc1dccd6f8bcbdabff63dfe93e1a20ccfcb36b` |

이 해시는 테스트용 공개 입력에 대한 증적이다. 실제 배포에서는 승인된 CloudFront·Cognito 공개 출력으로 다시 빌드해야 한다.

## 승인 후 남은 검증

[#356](https://github.com/dev-baek/bidflow/issues/356)에서 실제 배포 대상 커밋의 ECR digest, 운영 입력(AMI·DNS·TLS), CloudFront 정적 파일 응답과 애플리케이션 readiness를 확인한다. 실제 리소스 정리는 [#357](https://github.com/dev-baek/bidflow/issues/357)에서 기록한다.
