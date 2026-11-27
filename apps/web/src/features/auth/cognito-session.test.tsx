import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { AuthProvider, useAuth } from "./auth-context";
import { CognitoCallbackPage } from "../../pages/auth/CognitoCallbackPage";
import { LoginPage } from "../../pages/auth/LoginPage";
import { HomePage } from "../../pages/home/HomePage";
import { SiteLayout } from "../../app/SiteLayout";
import { RequireAuthenticated } from "../../pages/auth/RequireAuthenticated";
import { createProtectedApiClient, type AccessTokenSource } from "../../shared/api/api-client";

afterEach(cleanup);

function setup(route: string, complete = vi.fn(async () => ({
  accessToken: "private-token", expiresAt: Date.now() + 60_000,
}))) {
  const redirect = vi.fn(), clear = vi.fn(), begin = vi.fn(async () => "https://login.example.test/oauth2/authorize");
  const logoutUrl = "https://login.example.test/logout";
  let access: AccessTokenSource | undefined;
  function Controls() {
    const { signOut, signInLocal, state, cognitoAccess, completeCognito } = useAuth();
    access = cognitoAccess;
    return <>
      <output aria-label="session state">{state.mode}</output>
      <button onClick={signOut}>세션 지우기</button>
      <button onClick={() => signInLocal("not-a-cognito-user")}>로컬 요청</button>
      <button onClick={() => void completeCognito("https://example.test/auth/callback")}>다시 인증</button>
    </>;
  }
  render(<AuthProvider cognito={{ flow: { begin, complete, clear }, logoutUrl, redirect }}>
    <MemoryRouter initialEntries={[route]}>
      <Controls />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/auth/callback" element={<CognitoCallbackPage />} />
        <Route element={<SiteLayout />}>
          <Route path="/" element={<HomePage />} />
          <Route element={<RequireAuthenticated />}>
            <Route path="/listings/new" element={<p>보호된 등록 폼</p>} />
          </Route>
        </Route>
      </Routes>
    </MemoryRouter>
  </AuthProvider>);
  return { begin, complete, clear, redirect, logoutUrl, access: () => access! };
}

it("starts managed login and never accepts a local developer ID in Cognito mode", async () => {
  const { begin, redirect } = setup("/login");
  expect(screen.queryByLabelText("로컬 개발자 ID")).not.toBeInTheDocument();
  fireEvent.click(screen.getByText("로컬 요청"));
  expect(screen.getByLabelText("session state")).toHaveTextContent("ANONYMOUS");
  fireEvent.click(screen.getByRole("button", { name: "로그인 계속하기" }));
  expect(screen.getByRole("button", { name: "연결 중" })).toBeDisabled();
  expect(screen.getByText("로그인 화면으로 이동하고 있습니다.")).toHaveAttribute("role", "status");
  await waitFor(() => expect(redirect).toHaveBeenCalledWith("https://login.example.test/oauth2/authorize"));
  expect(begin).toHaveBeenCalledTimes(1);
});

it("completes the callback and signs out without rendering the access token", async () => {
  const { complete, clear, redirect, logoutUrl } = setup("/auth/callback");
  expect(await screen.findByRole("button", { name: "로그아웃" })).toBeInTheDocument();
  expect(complete).toHaveBeenCalledTimes(1);
  expect(screen.queryByText("private-token")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "로그아웃" }));
  expect(clear).toHaveBeenCalledTimes(1);
  expect(redirect).toHaveBeenCalledWith(logoutUrl);
  expect(screen.getByLabelText("session state")).toHaveTextContent("ANONYMOUS");
});

it("mounts protected UI for an authenticated Cognito session", async () => {
  setup("/auth/callback");
  fireEvent.click(await screen.findByRole("link", { name: "상품 등록하기" }));
  expect(screen.getByText("보호된 등록 폼")).toBeInTheDocument();
});

it("ignores a delayed 401 from an older session but expires the current session on 401", async () => {
  const { access } = setup("/auth/callback");
  await screen.findByRole("button", { name: "로그아웃" });
  const oldAccess = access();
  let finish!: (response: Response) => void;
  const oldClient = createProtectedApiClient("https://api.example.test",
    () => new Promise(resolve => { finish = resolve; }), oldAccess);
  const oldRequest = oldClient.get("/api/v1/me").catch(error => error);
  fireEvent.click(screen.getByText("다시 인증"));
  await waitFor(() => expect(access()).not.toBe(oldAccess));
  await waitFor(() => expect(access()?.token()).toBe("private-token"));
  expect(oldAccess.token()).toBeUndefined();
  await act(async () => { finish(new Response(null, { status: 401 })); await oldRequest; });
  expect(screen.getByLabelText("session state")).toHaveTextContent("AUTHENTICATED");
  const currentClient = createProtectedApiClient("https://api.example.test",
    async () => new Response(null, { status: 401 }), access());
  await act(async () => {
    await expect(currentClient.get("/api/v1/me")).rejects.toMatchObject({ status: 401 });
  });
  expect(screen.getByLabelText("session state")).toHaveTextContent("EXPIRED");
});

it("shows a safe login error when the callback is rejected", async () => {
  setup("/auth/callback", vi.fn(async () => { throw Error("private detail"); }));
  expect(await screen.findByRole("alert")).toHaveTextContent("로그인에 실패했습니다.");
  expect(screen.queryByText("private detail")).not.toBeInTheDocument();
});

it("shows callback progress, then offers managed sign-in again when the session is expired", async () => {
  let finish!: (session: { accessToken: string; expiresAt: number }) => void;
  const { begin } = setup("/auth/callback", vi.fn(() => new Promise(resolve => { finish = resolve; })));
  expect(screen.getByRole("heading", { name: "로그인 확인 중" })).toBeVisible();
  expect(screen.getByText("로그인을 확인하고 있습니다.")).toHaveAttribute("role", "status");
  await act(async () => finish({ accessToken: "expired-token", expiresAt: Date.now() - 1 }));
  expect(await screen.findByRole("alert")).toHaveTextContent("세션이 만료되었습니다.");
  expect(screen.queryByText("expired-token")).not.toBeInTheDocument();
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "로그인 계속하기" })));
  expect(begin).toHaveBeenCalledTimes(1);
});

it("does not restore a session if a callback resolves after sign-out", async () => {
  let finish!: (session: { accessToken: string; expiresAt: number }) => void;
  setup("/auth/callback", vi.fn(() => new Promise(resolve => { finish = resolve; })));
  fireEvent.click(screen.getByText("세션 지우기"));
  await act(async () => finish({ accessToken: "private-token", expiresAt: Date.now() + 60000 }));
  expect(screen.getByLabelText("session state")).toHaveTextContent("ANONYMOUS");
  expect(screen.queryByRole("button", { name: "로그아웃" })).not.toBeInTheDocument();
});

it("clears a Cognito session when its timer expires", async () => {
  vi.useFakeTimers();
  try {
    setup("/auth/callback", vi.fn(async () => ({ accessToken: "test", expiresAt: Date.now() + 500 })));
    await act(async () => {});
    expect(screen.getByLabelText("session state")).toHaveTextContent("AUTHENTICATED");
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(screen.getByLabelText("session state")).toHaveTextContent("EXPIRED");
  } finally { vi.useRealTimers(); }
});
