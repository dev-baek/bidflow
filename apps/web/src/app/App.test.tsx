import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import * as appRouter from "./create-router";

const validConfig = {
  ok: true as const,
  value: {
    apiBaseUrl: "https://api.bidflow.example",
    wsBaseUrl: "wss://api.bidflow.example/ws",
  },
};

describe("App", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    window.history.replaceState({}, "", "/");
  });

  it("renders an accessible application landmark when configuration is valid", () => {
    render(<App configResult={validConfig} />);

    expect(screen.getByRole("main")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "지금 진행 중인 경매를 둘러보세요" })).toBeInTheDocument();
    const main = within(screen.getByRole("main"));
    expect(main.getByRole("link", { name: "경매 둘러보기" })).toHaveClass("ui-button--primary");
    expect(main.getByRole("link", { name: "상품 등록하기" })).toHaveClass("ui-button--secondary");
    expect(within(screen.getByRole("navigation", { name: "주 메뉴" })).getByRole("link", { name: "홈" }))
      .toHaveAttribute("aria-current", "page");
  });

  it("keeps the current menu and protected registration behavior", async () => {
    window.history.replaceState({}, "", "/listings");
    render(<App configResult={validConfig} />);
    const nav = within(screen.getByRole("navigation", { name: "주 메뉴" }));
    expect(nav.getByRole("link", { name: "경매" })).toHaveAttribute("aria-current", "page");
    fireEvent.click(nav.getByRole("link", { name: "상품 등록" }));
    expect(await screen.findByText("상품을 등록하려면 먼저 로그인해 주세요.")).toBeVisible();
    expect(screen.queryByRole("navigation", { name: "주 메뉴" })).not.toBeInTheDocument();
  });

  it("shows a configuration error instead of a blank page", () => {
    vi.stubEnv("DEV", true);
    render(
      <App
        configResult={{
          ok: false,
          reason: "api-url",
        }}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "연결 설정이 올바르지 않아 서비스를 열 수 없습니다.",
    );
    expect(screen.getByText(/VITE_API_BASE_URL 설정을 확인/)).toBeVisible();
    expect(screen.getByRole("button", { name: "새로고침" })).toBeVisible();
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  });

  it("shows only recovery guidance in a deployed build", () => {
    vi.stubEnv("DEV", false);
    render(<App configResult={{ ok: false, reason: "ws-url" }} />);
    expect(screen.getByText(/계속되면 서비스 운영자에게 문의/)).toBeVisible();
    expect(screen.queryByText(/VITE_|Cognito/)).not.toBeInTheDocument();
  });

  it("shows a not-found page for an unknown route", () => {
    window.history.replaceState({}, "", "/unknown");

    render(<App configResult={validConfig} />);

    expect(
      screen.getByRole("heading", { name: "페이지를 찾을 수 없습니다" }),
    ).toBeInTheDocument();
    const main = within(screen.getByRole("main"));
    expect(main.getByRole("link", { name: "BidFlow 홈으로 돌아가기" })).toHaveAttribute("href", "/");
    fireEvent.click(main.getByRole("link", { name: "경매 둘러보기" }));
    expect(screen.getByRole("heading", { name: "상품 검색" })).toBeVisible();
  });

  it("rejects a Cognito callback origin different from the app without falling back to local login", () => {
    vi.stubEnv("DEV", true);
    const createRouter = vi.spyOn(appRouter, "createAppRouter");
    render(<App configResult={{
      ok: true, value: { ...validConfig.value, cognito: {
        issuer: "https://issuer.example.test/pool", origin: "https://login.example.test", clientId: "publicclient",
        redirectUri: "https://elsewhere.example.test/auth/callback",
      } },
    }} />);
    expect(screen.getByText(/공개 인증 설정과 콜백 주소/)).toBeVisible();
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    expect(screen.queryByText("로컬 로그인")).not.toBeInTheDocument();
    expect(createRouter).not.toHaveBeenCalled();
  });
});
