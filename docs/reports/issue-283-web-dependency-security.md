# 프런트 개발 의존성 보안 업데이트 결과

[#284에서 승인한 사양](../specs/issue-283-web-dependency-security.md)에 따라 #283의 개발 도구 의존성을 업데이트했다. 전체 npm audit의 영향 패키지는 6개에서 0개로 줄었고 production 범위는 전후 모두 0개였다. UI·API·DB·백엔드 로직과 CI 계약은 변경하지 않았다.

## 변경한 의존성

| 패키지 | 변경 전 | 변경 후 |
|---|---|---|
| vite | 8.1.5 | 8.1.6 |
| vitest 및 7개 동반 패키지 | 4.1.10 | 4.1.12 |
| nanoid | 3.3.16 | 3.3.20 |
| source-map-js | 1.2.1 | 1.2.4 |
| undici | 8.9.0 | 8.13.1 |

manifest는 Vite와 Vitest 두 고정 버전만 바꿨다. npm이 생성한 lock에는 위 변경과 Vitest 하위 경로의 재해결 4개가 포함된다. magic-string의 sourcemap-codec는 1.5.5→1.6.0, estree-walker의 @types/estree는 1.0.9→1.0.10, @vitest/expect의 chai는 6.2.2→6.3.0, Vitest 계열의 tinyrainbow는 3.1.1→3.2.0이다. 모두 기존 부모의 semver 범위 안이며, 패키지 추가·제거와 major 변경은 없다. 나머지 직접 의존성과 lock 해결 버전은 유지했다.

전이 의존성을 직접 의존성이나 override로 추가하지 않았고, audit fix --force·legacy-peer-deps·전체 일괄 업데이트는 사용하지 않았다. 전체 실제 버전 차이는 [실행 증적](evidence/issue-283-web-dependency-security.json)에 남겼다.

## 보안 기준과 재설치

동일 main lock의 재조회가 RED, 업데이트 뒤의 audit이 GREEN이다. 구성 변경에 불필요한 앱 로직이나 가짜 단위 테스트를 추가하지 않았다.

| 조회 시각 UTC | 범위 | 영향 패키지 | 종료 코드 |
|---|---|---|---|
| 2026년 11월 21일 12:03:08 | 변경 전 전체 | high 4·moderate 2, 총 6 | 1 |
| 같은 조회 | 변경 전 production | 0 | 0 |
| 2026년 11월 21일 12:07:04 | 변경 후 전체 | 0 | 0 |
| 같은 조회 | 변경 후 production | 0 | 0 |

Node 24.18.0을 사용했다. 기존 npm 10.8.2는 lock 생성 중 Arborist loadPeerSet의 edgesOut 오류로 실패했다. 전역 설치나 캐시 권한 수정 없이 임시 디렉터리의 npm 11.21.3으로 재시도해 해결했다. 이 npm은 저장소 의존성으로 추가하지 않았다.

새 npm ci가 성공했고 npm ls --all은 exit 0/문제 없음이었다. 재설치 전후 manifest와 lock 차이는 없었으며 lock SHA-256은 `fd13de19db84544028e851199dfe9ed3e1ad8c7689f8ef2ddc92c348b347e212`로 같았다. npm 11은 fsevents 2.3.2/2.3.3의 승인되지 않은 설치 스크립트를 경고했지만 설치는 성공했고 이를 승인하거나 검사를 우회하지 않았다. 이후 테스트와 Vite 실행도 성공했다.

## 기본 검증

Java 21·Node 24에서 make verify가 exit 0으로 끝났다. Vitest는 17개 파일/71개 테스트, Node 스크립트는 57개가 통과했다. TypeScript/Vite production build도 성공했다. 백엔드 unitTest와 bootJar는 기존 결과를 UP-TO-DATE로 재사용했으며 전체 integration check를 다시 실행한 것은 아니다.

원격 CI는 구현 PR의 최신 커밋에서 별도로 확인한다. 로컬 결과를 원격 성공으로 대신하지 않는다.

## 실제 브라우저 검증과 복원

코드 커밋 `b829cf3752f13bdd8b2a515fc51367be7081d2bc`에서 Chromium 145.0.7632.6/Playwright 1.58.2로 실행했다. worker 1·retry 0이며 성공 3개·실패/skip/flaky 0개였다.

- 자동입찰·연장·마감 이후 낙찰 불변과 개인 결과 분리
- 직접입찰 재시도의 동일 요청 처리와 후속 입찰의 새 요청 처리
- 순차 입찰 20건의 개인 결과와 양쪽 화면 완료

이 사례들의 상품 등록·이미지 업로드 경로도 유지됐다. 순차 화면 완료 P95는 613.65ms로 기존 2초 기준을 통과했다. 이는 도구 업데이트의 회귀 확인이며 성능 개선이나 동시 부하 결과가 아니다. 테스트 전후 bid-settlement의 세 파티션 lag는 모두 0이었다.

검증 JVM은 local,e2e/100ms/INFO, Vite는 loopback으로 실행했다. 기존 API를 완전히 종료한 뒤 교체했고, 테스트 JVM과 Vite도 완전히 종료한 후 원래 jar hash·local/명시적 1,000ms/INFO 인자로 복원했다. listen PID·실행 인자·readiness UP을 확인했다. 시험 데이터는 보존했으며 원문 서버 로그·Token·trace·전체 reporter는 커밋하지 않았다.

## 범위와 한계

나머지 4개 E2E와 전체 백엔드 통합 check, 새 부하 검증은 이번 결과에 포함하지 않는다. AWS 접근·배포·DB/볼륨/offset 초기화와 사용자 전역 설정 변경은 없으며 원본 폴더의 미추적 lock과 복제 파일도 보존했다.

audit 0은 조회 시점 registry의 알려진 경고가 없다는 뜻이다. 모든 보안 위험이 없거나 실제 공격을 재현·차단했다는 보장은 아니며 Node 내장 fetch의 undici까지 업데이트한 것도 아니다.
