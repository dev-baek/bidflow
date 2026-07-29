# React Vite Bootstrap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Issue #30의 React.js·TypeScript·Vite SPA와 테스트 기반을 만들고, 런타임 설정·비동기 화면 상태·API 경계를 테스트 가능한 구조로 확정한다.

**Architecture:** `app → pages → features → shared` 의존 방향을 사용한다. 상태 전이는 순수 Reducer로 계산하고 환경변수·브라우저·HTTP 접근은 조립 경계로 격리한다. 이 단계에서는 서버 상태 라이브러리와 전역 상태 라이브러리를 도입하지 않는다.

**Tech Stack:** Node.js 24 LTS, npm, React 19.2.8, TypeScript 7.0.2, Vite 8.1.5, React Router, Vitest 4.1.10, React Testing Library 16.3.2, jsdom 30.0.0

## Global Constraints

- 작업 Issue: [#30](https://github.com/dev-baek/bidflow/issues/30)
- 작업 브랜치: `feature/issue-30-react-vite-bootstrap`
- 선행 조건: 본 계획 PR이 승인되어 `main`에 병합되어 있어야 한다.
- 모든 동작 구현은 실패 테스트 작성, 예상한 이유의 실패 확인, 최소 구현, 전체 통과, 리팩터링 순서를 지킨다.
- Reducer, Selector, 설정 해석 함수는 같은 입력에 같은 출력을 반환하며 입력 객체를 변경하지 않는다.
- `window`, `import.meta.env`, `fetch` 접근은 파일 경계에서만 수행하고 순수 함수에 직접 포함하지 않는다.
- Scaffold와 TypeScript/Vite 설정은 동작 테스트의 실익이 없는 TDD 예외로 취급하되 `npm run build`와 `npm test -- --run` 결과를 PR에 남긴다.
- `VITE_` 변수에는 공개 가능한 URL만 두며 Secret은 저장하지 않는다.
- `any`, 비어 있는 구현, `TODO`, 테스트 비활성화는 완료 상태로 인정하지 않는다.

---

## Task 1: 재현 가능한 Vite 프로젝트 뼈대 구성

**Files:**

- Create: `apps/web/package.json`
- Create: `apps/web/package-lock.json`
- Create: `apps/web/index.html`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/tsconfig.app.json`
- Create: `apps/web/tsconfig.node.json`
- Create: `apps/web/vite.config.ts`
- Create: `apps/web/src/vite-env.d.ts`
- Create: `apps/web/src/test/setup.ts`

**Interfaces:**

- Consumes: Node.js 24와 npm이 설치된 `main` 작업 복사본
- Produces: `npm --prefix apps/web run build`, `npm --prefix apps/web test -- --run` 실행 계약과 jsdom Test Runtime

- [ ] **Step 1: 브랜치와 실행 환경을 확인한다.**

```bash
git switch main
git pull --ff-only origin main
git switch -c feature/issue-30-react-vite-bootstrap
node --version
npm --version
```

Expected: Node.js 출력의 Major가 `24`이고 브랜치가 생성된다. Major가 다르면 파일을 만들기 전에 Node.js 24로 전환한다.

- [ ] **Step 2: `package.json`에 실행 계약과 버전을 고정한다.**

```json
{
  "name": "@bidflow/web",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "engines": {
    "node": "24.x"
  },
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "test": "vitest",
    "test:run": "vitest run"
  },
  "dependencies": {
    "react": "19.2.8",
    "react-dom": "19.2.8",
    "react-router-dom": "7.18.2"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "7.0.0",
    "@testing-library/react": "16.3.2",
    "@types/react": "19.2.17",
    "@types/react-dom": "19.2.3",
    "@vitejs/plugin-react": "6.0.4",
    "jsdom": "30.0.0",
    "typescript": "7.0.2",
    "vite": "8.1.5",
    "vitest": "4.1.10"
  }
}
```

- [ ] **Step 3: 설치 결과를 Lock File로 고정한다.**

Run:

```bash
npm --prefix apps/web install
npm --prefix apps/web ci
```

Expected: `package-lock.json`이 생성되고 `npm ci`가 수정 없이 성공한다.

- [ ] **Step 4: TypeScript·Vite·jsdom 설정을 작성한다.**

`vite.config.ts`:

```ts
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
  },
});
```

`tsconfig.json`:

```json
{
  "files": [],
  "references": [
    { "path": "./tsconfig.app.json" },
    { "path": "./tsconfig.node.json" }
  ]
}
```

`tsconfig.app.json`은 `ES2023`, `DOM`, `react-jsx`, `strict`, `noUncheckedIndexedAccess`와 `src` Include를 사용한다. `tsconfig.node.json`은 `vite.config.ts`를 Include한다. `src/test/setup.ts`의 전체 내용은 다음 한 줄이다.

```ts
import "@testing-library/jest-dom/vitest";
```

- [ ] **Step 5: 설정 자체를 검증한다.**

Run:

```bash
npm --prefix apps/web exec tsc -- --showConfig
npm --prefix apps/web test -- --run --passWithNoTests
```

Expected: TypeScript 설정을 읽을 수 있고 Vitest가 구성 오류 없이 종료한다.

- [ ] **Step 6: Scaffold를 커밋한다.**

```bash
git add apps/web
git commit -m "build(web): initialize React Vite workspace"
```

---

## Task 2: 비동기 화면 상태를 순수 상태 기계로 구현

**Files:**

- Create: `apps/web/src/shared/state/async-state.test.ts`
- Create: `apps/web/src/shared/state/async-state.ts`
- Create: `apps/web/src/shared/state/index.ts`

**Interfaces:**

- Consumes: Task 1의 Vitest Runtime
- Produces: `initialAsyncState<T>(): AsyncState<T>`, `reduceAsyncState<T>(state: AsyncState<T>, event: AsyncEvent<T>): AsyncState<T>`

- [ ] **Step 1: 로딩·성공·빈 결과·오류·재시도를 표현하는 실패 테스트를 작성한다.**

```ts
import { describe, expect, it } from "vitest";
import { initialAsyncState, reduceAsyncState } from "./async-state";

describe("reduceAsyncState", () => {
  it("starts loading from idle", () => {
    expect(reduceAsyncState(initialAsyncState<string>(), { type: "load" }))
      .toEqual({ status: "loading" });
  });

  it("distinguishes data and empty success", () => {
    expect(reduceAsyncState({ status: "loading" }, { type: "succeed", data: ["auction"] }))
      .toEqual({ status: "success", data: ["auction"] });
    expect(reduceAsyncState({ status: "loading" }, { type: "succeed", data: [] }))
      .toEqual({ status: "empty" });
  });

  it("keeps an error message and retries from error", () => {
    const failed = reduceAsyncState<string[]>({ status: "loading" }, {
      type: "fail",
      message: "목록을 불러오지 못했습니다.",
    });
    expect(failed).toEqual({ status: "error", message: "목록을 불러오지 못했습니다." });
    expect(reduceAsyncState(failed, { type: "retry" })).toEqual({ status: "loading" });
  });

  it("does not mutate the previous state", () => {
    const previous = Object.freeze({ status: "success" as const, data: ["auction"] });
    reduceAsyncState(previous, { type: "load" });
    expect(previous).toEqual({ status: "success", data: ["auction"] });
  });
});
```

- [ ] **Step 2: RED를 확인한다.**

Run:

```bash
npm --prefix apps/web test -- --run src/shared/state/async-state.test.ts
```

Expected: `./async-state` 모듈이 없어서 실패한다.

- [ ] **Step 3: 최소 상태 타입과 Reducer를 구현한다.**

```ts
export type AsyncState<T> =
  | { readonly status: "idle" }
  | { readonly status: "loading" }
  | { readonly status: "success"; readonly data: T }
  | { readonly status: "empty" }
  | { readonly status: "error"; readonly message: string };

export type AsyncEvent<T> =
  | { readonly type: "load" | "retry" }
  | { readonly type: "succeed"; readonly data: T }
  | { readonly type: "fail"; readonly message: string };

export function initialAsyncState<T>(): AsyncState<T> {
  return { status: "idle" };
}

export function reduceAsyncState<T>(
  state: AsyncState<T>,
  event: AsyncEvent<T>,
): AsyncState<T> {
  if (event.type === "load" || event.type === "retry") return { status: "loading" };
  if (event.type === "fail") return { status: "error", message: event.message };
  if (Array.isArray(event.data) && event.data.length === 0) return { status: "empty" };
  return { status: "success", data: event.data };
}
```

- [ ] **Step 4: GREEN과 전체 프론트 테스트를 확인한다.**

```bash
npm --prefix apps/web test -- --run src/shared/state/async-state.test.ts
npm --prefix apps/web test -- --run
```

Expected: 네 테스트와 전체 테스트가 통과한다.

- [ ] **Step 5: 공개 진입점을 추가하고 커밋한다.**

```bash
git add apps/web/src/shared/state
git commit -m "test(web): define pure async state transitions"
```

---

## Task 3: 런타임 설정 해석과 Bootstrap 상태 구현

**Files:**

- Create: `apps/web/src/shared/config/runtime-config.test.ts`
- Create: `apps/web/src/shared/config/runtime-config.ts`
- Create: `apps/web/src/app/bootstrap-state.test.ts`
- Create: `apps/web/src/app/bootstrap-state.ts`

**Interfaces:**

- Consumes: Task 1의 TypeScript·Vitest Runtime
- Produces: `parseRuntimeConfig(env: Readonly<Record<string, string | undefined>>): RuntimeConfigResult`, `bootstrapReducer(state: BootstrapState, event: BootstrapEvent): BootstrapState`

- [ ] **Step 1: URL 검증의 정상·오류·경계 테스트를 먼저 작성한다.**

```ts
import { describe, expect, it } from "vitest";
import { parseRuntimeConfig } from "./runtime-config";

describe("parseRuntimeConfig", () => {
  it("returns normalized public endpoints", () => {
    expect(parseRuntimeConfig({
      VITE_API_BASE_URL: "https://api.bidflow.example/",
      VITE_WS_BASE_URL: "wss://api.bidflow.example/ws",
    })).toEqual({
      ok: true,
      value: {
        apiBaseUrl: "https://api.bidflow.example",
        wsBaseUrl: "wss://api.bidflow.example/ws",
      },
    });
  });

  it.each([
    [{ VITE_WS_BASE_URL: "wss://api.bidflow.example/ws" }, "VITE_API_BASE_URL"],
    [{ VITE_API_BASE_URL: "ftp://api.example", VITE_WS_BASE_URL: "wss://api.example/ws" }, "VITE_API_BASE_URL"],
    [{ VITE_API_BASE_URL: "https://api.example", VITE_WS_BASE_URL: "https://api.example/ws" }, "VITE_WS_BASE_URL"],
  ])("rejects invalid input", (input, field) => {
    expect(parseRuntimeConfig(input)).toEqual({
      ok: false,
      message: `${field} 설정을 확인하세요.`,
    });
  });
});
```

- [ ] **Step 2: RED를 확인한다.**

```bash
npm --prefix apps/web test -- --run src/shared/config/runtime-config.test.ts
```

Expected: `parseRuntimeConfig`가 없어서 실패한다.

- [ ] **Step 3: 환경 객체만 입력받는 순수 Parser를 구현한다.**

```ts
export type RuntimeConfig = Readonly<{
  apiBaseUrl: string;
  wsBaseUrl: string;
}>;

export type RuntimeConfigResult =
  | { readonly ok: true; readonly value: RuntimeConfig }
  | { readonly ok: false; readonly message: string };

export function parseRuntimeConfig(
  env: Readonly<Record<string, string | undefined>>,
): RuntimeConfigResult {
  const apiBaseUrl = validUrl(env.VITE_API_BASE_URL, ["http:", "https:"]);
  if (!apiBaseUrl) return { ok: false, message: "VITE_API_BASE_URL 설정을 확인하세요." };

  const wsBaseUrl = validUrl(env.VITE_WS_BASE_URL, ["ws:", "wss:"]);
  if (!wsBaseUrl) return { ok: false, message: "VITE_WS_BASE_URL 설정을 확인하세요." };

  return {
    ok: true,
    value: {
      apiBaseUrl: apiBaseUrl.replace(/\/$/, ""),
      wsBaseUrl: wsBaseUrl.replace(/\/$/, ""),
    },
  };
}

function validUrl(raw: string | undefined, protocols: readonly string[]): string | null {
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    return protocols.includes(parsed.protocol) ? raw : null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Bootstrap Reducer 실패 테스트를 작성한다.**

```ts
import { describe, expect, it } from "vitest";
import { bootstrapReducer, initialBootstrapState } from "./bootstrap-state";

describe("bootstrapReducer", () => {
  it("moves to ready with parsed config", () => {
    const config = { apiBaseUrl: "https://api.example", wsBaseUrl: "wss://api.example/ws" };
    expect(bootstrapReducer(initialBootstrapState, { type: "configLoaded", config }))
      .toEqual({ status: "ready", config });
  });

  it("moves to a visible error and supports retry", () => {
    const failed = bootstrapReducer(initialBootstrapState, {
      type: "configFailed",
      message: "환경 설정을 확인하세요.",
    });
    expect(failed).toEqual({ status: "error", message: "환경 설정을 확인하세요." });
    expect(bootstrapReducer(failed, { type: "retry" })).toEqual({ status: "loading" });
  });
});
```

- [ ] **Step 5: RED를 확인한 뒤 최소 Reducer를 구현한다.**

Run before implementation:

```bash
npm --prefix apps/web test -- --run src/app/bootstrap-state.test.ts
```

Expected: `bootstrapReducer`가 없어서 실패한다.

`bootstrap-state.ts`:

```ts
import type { RuntimeConfig } from "../shared/config/runtime-config";

export type BootstrapState =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly config: RuntimeConfig }
  | { readonly status: "error"; readonly message: string };

export type BootstrapEvent =
  | { readonly type: "configLoaded"; readonly config: RuntimeConfig }
  | { readonly type: "configFailed"; readonly message: string }
  | { readonly type: "retry" };

export const initialBootstrapState: BootstrapState = { status: "loading" };

export function bootstrapReducer(
  state: BootstrapState,
  event: BootstrapEvent,
): BootstrapState {
  if (event.type === "configLoaded") return { status: "ready", config: event.config };
  if (event.type === "configFailed") return { status: "error", message: event.message };
  return { status: "loading" };
}
```

- [ ] **Step 6: GREEN을 확인하고 커밋한다.**

```bash
npm --prefix apps/web test -- --run src/shared/config/runtime-config.test.ts src/app/bootstrap-state.test.ts
git add apps/web/src/shared/config apps/web/src/app/bootstrap-state*
git commit -m "test(web): validate runtime configuration state"
```

---

## Task 4: API Client 경계를 주입 가능한 Shell로 구현

**Files:**

- Create: `apps/web/src/shared/api/api-client.test.ts`
- Create: `apps/web/src/shared/api/api-client.ts`
- Create: `apps/web/src/shared/api/index.ts`

**Interfaces:**

- Consumes: Task 3의 `RuntimeConfig.apiBaseUrl` 문자열과 주입된 `typeof fetch`
- Produces: `createApiClient(baseUrl: string, request: typeof fetch): ApiClient`, `ApiClient.get<T>(path: string): Promise<T>`, `ApiError.status`

- [ ] **Step 1: URL 조립·응답·오류 계약 실패 테스트를 작성한다.**

```ts
import { describe, expect, it, vi } from "vitest";
import { createApiClient } from "./api-client";

describe("createApiClient", () => {
  it("requests the base URL and returns decoded JSON", async () => {
    const request = vi.fn(async () => new Response(JSON.stringify({ status: "ok" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    const client = createApiClient("https://api.example", request);

    await expect(client.get<{ status: string }>("/api/health"))
      .resolves.toEqual({ status: "ok" });
    expect(request).toHaveBeenCalledWith("https://api.example/api/health", {
      headers: { accept: "application/json" },
    });
  });

  it("throws an ApiError without hiding the status", async () => {
    const request = vi.fn(async () => new Response("", { status: 503 }));
    const client = createApiClient("https://api.example", request);
    await expect(client.get("/api/health")).rejects.toMatchObject({ status: 503 });
  });
});
```

- [ ] **Step 2: RED를 확인한다.**

```bash
npm --prefix apps/web test -- --run src/shared/api/api-client.test.ts
```

Expected: `createApiClient`가 없어서 실패한다.

- [ ] **Step 3: `fetch`를 인자로 받는 최소 Client를 구현한다.**

```ts
export type ApiClient = Readonly<{
  get<T>(path: string): Promise<T>;
}>;

export class ApiError extends Error {
  constructor(readonly status: number) {
    super(`API request failed with status ${status}`);
    this.name = "ApiError";
  }
}

export function joinApiUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
}

export function createApiClient(baseUrl: string, request: typeof fetch): ApiClient {
  return {
    async get<T>(path: string): Promise<T> {
      const response = await request(joinApiUrl(baseUrl, path), {
        headers: { accept: "application/json" },
      });
      if (!response.ok) throw new ApiError(response.status);
      return response.json() as Promise<T>;
    },
  };
}
```

- [ ] **Step 4: GREEN을 확인하고 커밋한다.**

```bash
npm --prefix apps/web test -- --run src/shared/api/api-client.test.ts
git add apps/web/src/shared/api
git commit -m "test(web): add injectable API client boundary"
```

---

## Task 5: Router와 접근 가능한 기본 Layout 조립

**Files:**

- Create: `apps/web/src/pages/home/HomePage.tsx`
- Create: `apps/web/src/pages/not-found/NotFoundPage.tsx`
- Create: `apps/web/src/app/App.test.tsx`
- Create: `apps/web/src/app/App.tsx`
- Create: `apps/web/src/app/create-router.tsx`
- Create: `apps/web/src/main.tsx`
- Create: `apps/web/src/styles.css`

**Interfaces:**

- Consumes: Task 3의 `RuntimeConfigResult`와 React Router의 `RouterProvider`
- Produces: `App({ configResult }: AppProps): ReactElement`, `/`와 `*` Route, `apps/web/dist/index.html`

- [ ] **Step 1: 사용자가 보는 기본 화면과 오류 화면 실패 테스트를 작성한다.**

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "./App";

describe("App", () => {
  it("renders an accessible main landmark when configuration is valid", () => {
    render(<App configResult={{
      ok: true,
      value: { apiBaseUrl: "https://api.example", wsBaseUrl: "wss://api.example/ws" },
    }} />);
    expect(screen.getByRole("main")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "BidFlow" })).toBeInTheDocument();
  });

  it("shows a configuration error instead of a blank page", () => {
    render(<App configResult={{ ok: false, message: "VITE_API_BASE_URL 설정을 확인하세요." }} />);
    expect(screen.getByRole("alert")).toHaveTextContent("VITE_API_BASE_URL 설정을 확인하세요.");
  });
});
```

- [ ] **Step 2: RED를 확인한다.**

```bash
npm --prefix apps/web test -- --run src/app/App.test.tsx
```

Expected: `App` 모듈이 없어서 실패한다.

- [ ] **Step 3: 최소 Layout과 Router를 구현한다.**

`App.tsx`:

```tsx
import { RouterProvider } from "react-router-dom";
import type { RuntimeConfigResult } from "../shared/config/runtime-config";
import { createAppRouter } from "./create-router";

export type AppProps = Readonly<{ configResult: RuntimeConfigResult }>;

export function App({ configResult }: AppProps) {
  if (!configResult.ok) return <main><p role="alert">{configResult.message}</p></main>;
  return <RouterProvider router={createAppRouter()} />;
}
```

`create-router.tsx`는 `createBrowserRouter`로 `/`와 `*`를 연결한다. `HomePage`는 `<main><h1>BidFlow</h1></main>`, `NotFoundPage`는 `<main><h1>페이지를 찾을 수 없습니다</h1></main>`을 반환한다.

`main.tsx`:

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { parseRuntimeConfig } from "./shared/config/runtime-config";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("root element is required");

createRoot(root).render(
  <StrictMode>
    <App configResult={parseRuntimeConfig(import.meta.env)} />
  </StrictMode>,
);
```

- [ ] **Step 4: GREEN과 Production Build를 확인한다.**

```bash
npm --prefix apps/web test -- --run
VITE_API_BASE_URL=http://localhost:8080 \
VITE_WS_BASE_URL=ws://localhost:8080/ws \
npm --prefix apps/web run build
test -f apps/web/dist/index.html
```

Expected: 전체 테스트가 통과하고 `apps/web/dist/index.html`이 생성된다.

- [ ] **Step 5: 조립 코드를 커밋한다.**

```bash
git add apps/web
git commit -m "feat(web): render configured application shell"
```

---

## Task 6: Issue 완료 증적과 PR 작성

**Files:**

- Create: `docs/reports/issue-030-react-vite-bootstrap.md`

**Interfaces:**

- Consumes: Task 1~5의 실제 RED·GREEN 명령 출력과 Git 변경
- Produces: Issue #30 검증 보고서와 `Closes #30` PR

- [ ] **Step 1: 보고서에 실제 실행 결과를 기록한다.**

보고서에는 다음을 숫자와 실제 출력 요약으로 기록한다.

```text
RED
- async-state 테스트 명령과 구현 부재 실패
- runtime-config/bootstrap-state 테스트 명령과 구현 부재 실패
- api-client 테스트 명령과 구현 부재 실패
- App 테스트 명령과 구현 부재 실패

GREEN
- npm --prefix apps/web test -- --run
- 통과 Test File 수와 Test 수
- Production Build 결과

MANUAL
- Node.js/npm 버전
- 생성된 dist/index.html
- React 경고와 처리되지 않은 오류 유무
```

- [ ] **Step 2: Placeholder와 변경 범위를 점검한다.**

```bash
rg -n 'TODO|TBD|FIXME|\\.skip\\(|\\.only\\(' apps/web docs/reports/issue-030-react-vite-bootstrap.md
git diff --check
git status --short
```

Expected: Placeholder와 비활성 테스트가 없고 공백 오류가 없다.

- [ ] **Step 3: 최종 검증을 새로 실행한다.**

```bash
npm --prefix apps/web ci
npm --prefix apps/web test -- --run
VITE_API_BASE_URL=http://localhost:8080 \
VITE_WS_BASE_URL=ws://localhost:8080/ws \
npm --prefix apps/web run build
```

- [ ] **Step 4: 보고서를 커밋하고 원격 브랜치를 올린다.**

```bash
git add docs/reports/issue-030-react-vite-bootstrap.md
git commit -m "docs(web): record issue 30 verification"
git push -u origin feature/issue-30-react-vite-bootstrap
```

- [ ] **Step 5: PR을 생성한다.**

PR 제목: `[S] React.js·TypeScript·Vite 프론트엔드 기반 구성`

PR 본문에는 `Closes #30`, RED/GREEN/MANUAL 증적, TDD 예외인 Scaffold 검증 근거, 남은 경고 유무를 포함한다. Reviewer가 병합하기 전까지 #31 또는 #32 변경을 이 브랜치에 추가하지 않는다.
