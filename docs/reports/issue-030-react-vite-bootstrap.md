# [Issue #30] React·TypeScript·Vite 프론트엔드 기반 검증 보고서

- 작업일: 2026-07-29
- Issue: [#30 React.js·TypeScript·Vite 프론트엔드 프로젝트 초기화](https://github.com/dev-baek/bidflow/issues/30)
- 구현계획: [`2026-07-29-react-vite-bootstrap.md`](../superpowers/plans/2026-07-29-react-vite-bootstrap.md)
- 브랜치: `feature/issue-30-react-vite-bootstrap`

## 1. 구현 결과

- React 19·TypeScript 7·Vite 8 기반 SPA와 npm Lock File을 구성했다.
- Vitest·React Testing Library·jsdom 테스트 환경을 구성했다.
- 로딩·성공·빈 결과·오류·재시도 상태를 순수 Reducer로 구현했다.
- API와 WebSocket 환경변수를 순수 함수로 검증한다.
- Bootstrap 준비·오류·재시도 상태를 순수 Reducer로 구현했다.
- `fetch`를 생성 시점에 주입하는 API Client 경계를 구현했다.
- `/`와 알 수 없는 경로를 처리하는 Browser Router와 기본 Layout을 구현했다.
- 화면과 상태 계산에서 서버 데이터의 중복 State를 만들지 않았다.

## 2. RED 증적

| 대상 | 실행 명령 | 확인한 실패 |
|---|---|---|
| 비동기 상태 | `npm --prefix apps/web test -- --run src/shared/state/async-state.test.ts` | `./async-state` Module 부재로 실패 |
| 런타임 설정 | `npm --prefix apps/web test -- --run src/shared/config/runtime-config.test.ts` | `./runtime-config` Module 부재로 실패 |
| Bootstrap 상태 | `npm --prefix apps/web test -- --run src/app/bootstrap-state.test.ts` | `./bootstrap-state` Module 부재로 실패 |
| API Client | `npm --prefix apps/web test -- --run src/shared/api/api-client.test.ts` | `./api-client` Module 부재로 실패 |
| App·Router | `npm --prefix apps/web test -- --run src/app/App.test.tsx` | `./App` Module 부재로 실패 |
| Type 계약 | `npm --prefix apps/web run build` | `load | retry`를 한 Variant로 묶어 `succeed.data`가 좁혀지지 않는 `TS2339` 실패 |

Type 계약 실패는 `load`와 `retry`를 독립된 Discriminated Union Variant로 나누는 최소 수정으로 해결했다.

## 3. GREEN 증적

Node.js 24 실행 환경에서 다음 명령을 사용했다.

```bash
npm_config_cache=work/npm-cache npx -y -p node@24 -c \
  'npm --prefix apps/web test -- --run'

npm_config_cache=work/npm-cache npx -y -p node@24 -c \
  'VITE_API_BASE_URL=http://localhost:8080 \
   VITE_WS_BASE_URL=ws://localhost:8080/ws \
   npm --prefix apps/web run build'
```

결과:

- Node.js: `v24.18.0`
- npm: `10.8.2`
- Test Files: `5 passed`
- Tests: `18 passed`
- 실패·건너뜀 Test: `0`
- Vite Build: `28 modules transformed`
- JavaScript Bundle: `286.58 kB`, gzip `91.46 kB`
- `apps/web/dist/index.html` 생성 확인

Scaffold와 Vite·TypeScript 설정은 동작 테스트의 실익이 낮은 TDD 예외로 처리했다. 대신 `npm ci`, TypeScript 설정 해석, 빈 Vitest 실행과 Production Build를 차례로 검증했다.

## 4. 브라우저 검증

검증 흐름:

```text
/ 접속
→ BidFlow Landmark와 제목 확인
→ /unknown 이동
→ 404 화면 확인
→ "BidFlow 홈으로 돌아가기" 선택
→ / 복귀와 제목 확인
```

| 검사 | 결과 |
|---|---|
| Page URL·Title | `http://127.0.0.1:4173/`, `BidFlow` |
| 빈 화면 | 의미 있는 `main`, `h1`, 설명 문구 렌더링 |
| Framework Overlay | 없음 |
| Console Warning·Error | 데스크톱·상호작용·모바일 모두 0건 |
| 데스크톱 | 첫 Viewport에서 카드·제목·설명 겹침 없음 |
| 모바일 | `390 × 844`, Page Scroll Width `390`, 수평 Overflow 없음 |
| Router 상호작용 | `/unknown`의 홈 Link 1개 확인 후 `/` 복귀 |

## 5. npm Audit 판정

`npm audit`는 `react-router-dom 7.18.2`에 High 2건을 표시했다. 그러나 경고의 원인이 된 `GHSA-qwww-vcr4-c8h2` 공식 Advisory는 React Router 7.x의 패치 버전을 `>= 7.18.2`로 명시한다.

- 사용 버전: `react-router-dom 7.18.2`, `react-router 7.18.2`
- 공식 패치 범위: `>= 7.18.2`
- 판정: npm Audit가 7.x와 8.x 취약 범위를 합쳐 표시한 Metadata 오탐
- 근거: [GitHub Security Advisory GHSA-qwww-vcr4-c8h2](https://github.com/remix-run/react-router/security/advisories/GHSA-qwww-vcr4-c8h2)

취약한 과거 버전 `7.11.0`으로 낮추지 않고 공식 패치 버전인 `7.18.2`를 유지한다.

## 6. 계획 대비 변경

계획의 `npm --prefix apps/web exec tsc -- --showConfig`는 npm 10에서 `EUSAGE`로 실패했다. 동일하게 설치된 TypeScript Binary를 다음 명령으로 실행해 설정을 검증했다.

```bash
cd apps/web
./node_modules/.bin/tsc --showConfig
```

애플리케이션 동작이나 의존성 변경이 아니라 npm CLI 호출 형식 차이에 대한 실행 명령 수정이다.

## 7. 완료 조건

- [x] React.js·TypeScript·Vite 개발 서버와 Production Build 실행
- [x] Vitest와 React Testing Library를 한 명령으로 실행
- [x] 상태 전이를 Red–Green–Refactor 순서로 구현
- [x] 로딩·성공·빈 결과·오류·재시도 검증
- [x] 런타임 설정 정상·오류·Protocol 경계 검증
- [x] API Client 정상·HTTP 오류 검증
- [x] 기본 Landmark·구성 오류·404 Route 검증
- [x] 데스크톱·모바일 렌더링과 Console 상태 확인
- [x] RED·GREEN·MANUAL 증적 기록
