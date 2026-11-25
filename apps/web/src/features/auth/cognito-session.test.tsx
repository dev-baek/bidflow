import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { AuthProvider, useAuth } from "./auth-context";
import { CognitoCallbackPage } from "../../pages/auth/CognitoCallbackPage";
import { LoginPage } from "../../pages/auth/LoginPage";
import { HomePage } from "../../pages/home/HomePage";
import { RequireAuthenticated } from "../../pages/auth/RequireAuthenticated";

afterEach(cleanup);

function setup(route: string, complete = vi.fn(async () => ({
  accessToken: "private-token", expiresAt: Date.now() + 60_000,
}))) {
  const redirect = vi.fn(), clear = vi.fn(), begin = vi.fn(async () => "https://login.example.test/oauth2/authorize");
  const logoutUrl = "https://login.example.test/logout";
  function Controls() {
    const { signOut, signInLocal, state } = useAuth();
    return <>
      <output aria-label="session state">{state.mode}</output>
      <button onClick={signOut}>세션 지우기</button>
      <button onClick={() => signInLocal("not-a-cognito-user")}>로컬 요청</button>
    </>;
  }
  render(<AuthProvider cognito={{ flow: { begin, complete, clear }, logoutUrl, redirect }}>
    <MemoryRouter initialEntries={[route]}>
      <Controls />
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/auth/callback" element={<CognitoCallbackPage />} />
        <Route element={<RequireAuthenticated />}>
          <Route path="/listings/new" element={<p>보호된 등록 폼</p>} />
        </Route>
      </Routes>
    </MemoryRouter>
  </AuthProvider>);
  return { begin, complete, clear, redirect, logoutUrl };
}

it("starts managed login and never accepts a local developer ID in Cognito mode", async () => {
  const { begin, redirect } = setup("/login");
  expect(screen.queryByLabelText("로컬 개발자 ID")).not.toBeInTheDocument();
  fireEvent.click(screen.getByText("로컬 요청"));
  expect(screen.getByLabelText("session state")).toHaveTextContent("ANONYMOUS");
  fireEvent.click(screen.getByRole("button", { name: "Cognito 로그인" }));
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

it("does not mount local-only protected UI for a Cognito session", async () => {
  setup("/auth/callback");
  fireEvent.click(await screen.findByRole("link", { name: "상품 등록 화면 열기" }));
  expect(screen.getByText("Cognito 세션의 보호 요청 연결은 아직 지원하지 않습니다.")).toBeInTheDocument();
  expect(screen.queryByText("보호된 등록 폼")).not.toBeInTheDocument();
});

it("shows a safe login error when the callback is rejected", async () => {
  setup("/auth/callback", vi.fn(async () => { throw Error("private detail"); }));
  expect(await screen.findByRole("alert")).toHaveTextContent("로그인에 실패했습니다.");
  expect(screen.queryByText("private detail")).not.toBeInTheDocument();
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
