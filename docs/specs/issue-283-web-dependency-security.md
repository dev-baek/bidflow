# 프런트 개발 의존성 보안 업데이트 사양

- 상태: #284 병합으로 승인됨. 승인한 범위의 업데이트와 로컬 검증은 [구현 보고서](../reports/issue-283-web-dependency-security.md)에 기록한다. 원격 CI와 구현 PR 병합은 별도로 확인한다.
- 이슈: [#283](https://github.com/dev-baek/bidflow/issues/283). 기존 경매 기능/부하 작업과 분리한 유지보수 이슈이며 Project 3에 추가했다.
- 기준선: [현재 audit 결과와 후보 메타데이터](../reports/evidence/issue-283-web-dependency-audit-baseline.json).

## 점검 결과와 목표

2026년 11월 21일 main `6892685b820cdcda9ad7ed53f358e56b59050a06`의 apps/web lock을 Node 24에서 조회했다. 전체 npm audit은 high 4개·moderate 2개, 총 **영향 패키지 6개**를 보고했고 exit 1이었다. via의 중복 URL을 제거한 보안 권고 링크는 27개다. 패키지 수 6과 권고 수를 혼동하지 않는다.

6개는 모두 lock의 dev 의존성이다. production 범위 audit은 0개/exit 0이었다. 다만 omit=dev 결과만으로 정적 bundle 전체나 개발 서버·CI의 보안을 보장하지 않는다. 앱에서 악용을 재현한 결과도 아니며 개발 환경의 노출 조건과 수정 가능성을 함께 본다.

목표는 현재 알려진 6개 패키지의 경고를 해소하고 기존 화면·빌드·테스트 흐름을 보존하는 것이다. audit 데이터베이스는 변하므로 구현 시 다시 조회하고 새 경고가 생기면 원인과 범위를 기록한다.

## S. 사용자 화면과 개발 환경

화면·API 동작은 바꾸지 않는다. Vite dev server와 Vitest/jsdom 도구 체인의 패치를 적용하되, 개발 서버는 기존 loopback 실행을 유지한다. production 경고가 없다는 이유로 개발 도구 경고를 무시하거나 외부 노출을 늘리지 않는다.

## D. 의존성 경로와 변경 후보

| 패키지 | 현재 lock | 경로 | 후보 |
|---|---|---|---|
| vite | 8.1.5 | 직접 dev 의존성 | 8.1.6 고정 |
| vitest | 4.1.10 | 직접 dev 의존성 | 4.1.12 고정 |
| @vitest/mocker | 4.1.10 | vitest → mocker | vitest와 함께 4.1.12 |
| nanoid | 3.3.16 | postcss → nanoid | 기존 3.x 범위에서 3.3.18 이상 |
| source-map-js | 1.2.1 | postcss/css-tree → source-map-js | 기존 1.x 범위에서 1.2.2 이상 |
| undici | 8.9.0 | jsdom → undici | 기존 8.x 범위에서 8.12.2 이상 |

Vite의 관련 8.1 계열 수정 버전은 [공식 권고 8.1.6](https://github.com/advisories/GHSA-rq7h-c2jc-7f22)이며, audit의 추천 8.3.8 대신 우선 같은 8.1 계열 패치를 사용한다. Vitest의 첫 mocker 수정 4.1.11만으로는 [추가 권고](https://github.com/advisories/GHSA-qxg6-89mg-rqv8)가 남으므로 4.1.12를 후보로 잡는다. [앞선 권고](https://github.com/advisories/GHSA-82fw-gwwq-j7x9)와 중복 계층도 함께 확인한다.

전이 패키지의 수정 기준은 [nanoid](https://github.com/advisories/GHSA-2v37-7h3g-55p8), [source-map-js](https://github.com/advisories/GHSA-68fv-2mgg-jv7q), [undici](https://github.com/advisories/GHSA-2m5v-pch6-74hx)의 권고와 현재 audit의 영향 범위를 따른다. 현재 부모 범위 ^3.3.16, ^1.2.1, ^8.7.0 안에서 해결할 수 있으므로 직접 의존성으로 새로 추가하거나 override하지 않는 방법을 우선한다. npm 패키지 undici 수정과 Node 내장 fetch의 구현 버전은 별개다.

공식 registry의 후보 metadata에서 Vite/Vitest의 Node 조건과 undici의 Node >=22.19.0을 확인했으며 프로젝트의 Node 24와 맞는다. React plugin의 Vite ^8.0.0, Vitest의 Vite ^8.0.0 허용 범위도 유지한다. 실제 install/peer 해결과 audit 해소는 승인 후 검증해야 한다.

## B. 최소 구현 경계

apps/web/package.json의 두 직접 dev 버전과 apps/web/package-lock.json의 필요한 해결 결과만 변경한다. Vitest 동반 패키지의 버전 정렬과 Vite 패치의 필수 하위 변경은 허용하되 무관한 major 업데이트·UI 변경·백엔드 변경은 하지 않는다. lock은 npm으로 생성하고 integrity를 손으로 조작하지 않는다.

peer 충돌이나 예상 밖의 큰 변경이 발생하면 원인을 확인해 범위를 다시 보고한다. npm audit fix --force, --legacy-peer-deps, 경고 숨김, 전체 패키지 무조건 업데이트를 사용하지 않는다. 새 버전 검사 프레임워크나 별도 취약점 스캐너를 만들지 않는다.

## I. 실행 경계

깨끗한 worktree와 Node 24에서 수행한다. 필요하면 새 임시 npm cache를 사용하며 사용자 전역 캐시의 파일·권한은 바꾸지 않는다. 루트 미추적 package-lock.json과 복제 파일은 보존한다.

기존 make verify/CI 계약을 유지한다. registry에 의존하는 live audit은 업데이트 전후 별도로 기록하며, 이번 범위에서 기본 CI에 새 네트워크 의존 보안 gate를 추가하지 않는다. 기존 서비스·AWS·배포·DB·볼륨/offset 초기화는 필요 없다.

## T. 보안 기준과 회귀 검증

1. RED는 변경 전 동일 lock의 전체 audit exit 1/6개 경고로 기록한다. 구성/의존성 업데이트이므로 앱에 취약 코드를 새로 만들거나 불필요한 가짜 단위 테스트를 추가하지 않는다. 새 실행 로직을 만들게 되면 별도 실패 테스트를 먼저 작성한다.
2. 두 직접 패치와 범위 내 전이 해결을 적용하고 새 npm ci로 lock 재현성·Node/peer 호환을 확인한다. npm ls에서 invalid 의존성이 없어야 하며 재설치 후 manifest/lock이 추가로 바뀌지 않아야 한다.
3. 전체 audit과 --omit=dev audit을 다시 실행한다. 현재 6개 패키지의 영향 범위가 사라지고 전체 audit exit 0을 목표로 한다. registry/네트워크 오류를 0건으로 세지 않고, 남은 새 권고는 원인과 조치 없이 예외 처리하지 않는다.
4. 전체 Vitest·Node script·양쪽 build와 실제 PR CI를 확인한다. Vite와 Vitest 양쪽에서 jsdom·mock·상태 테스트가 유지돼야 한다.
5. Vite 패치의 실제 로컬 경로는 별도 Browser 실행으로 확인한다. 상품 등록/업로드·직접/자동입찰·종료/개인 결과를 포함한 기존 핵심 사례를 worker 1/retry 0으로 수행한다. 실행 API를 교체하면 기존 설정으로 복원하고 실제 실행 범위·미실행 사례를 보고한다. 성능 임계값을 바꾸지 않는다.

보고서에는 변경 전후 audit 시각/Node·npm/lock hash, 패키지별 실제 해결 버전, 제외한 변경, npm ci·회귀·브라우저/CI 결과와 남은 한계를 남긴다. audit 0은 알려진 registry 경고가 없다는 뜻이지 모든 보안 위험이나 공격 가능성이 0이라는 보장은 아니다.
