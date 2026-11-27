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
    expect(screen.getByRole("heading", { name: "경매 상품 찾기" })).toBeInTheDocument();
    const main = within(screen.getByRole("main"));
    expect(main.getByRole("button", { name: "검색" })).toHaveClass("ui-button--primary");
    expect(main.getByRole("link", { name: "경매 둘러보기" })).toHaveAttribute("href", "/listings?sort=RELEVANCE");
    expect(main.getByRole("link", { name: "상품 등록하기" })).toHaveClass("ui-button--secondary");
    expect(within(screen.getByRole("navigation", { name: "주 메뉴" })).getByRole("link", { name: "홈" }))
      .toHaveAttribute("aria-current", "page");
  });

  it("uses search URLs for category and keyboard keyword navigation", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json({ items: [], nextCursor: null }));
    render(<App configResult={validConfig} />);
    const categories = within(screen.getByRole("navigation", { name: "카테고리" }));
    fireEvent.click(categories.getByRole("link", { name: "디지털·가전" }));
    expect(await screen.findByText("조건에 맞는 상품이 없습니다.")).toBeVisible();
    expect(window.location.pathname).toBe("/listings");
    expect(new URLSearchParams(window.location.search).get("categoryId")).toBe("DIGITAL");
    expect(screen.getByLabelText("카테고리")).toHaveValue("DIGITAL");
    fireEvent.click(screen.getByRole("link", { name: "BidFlow 홈" }));
    const homeSearch = screen.getByRole("search", { name: "홈 상품 검색" });
    fireEvent.change(within(homeSearch).getByRole("searchbox"), { target: { value: "  카메라 + 렌즈  " } });
    fireEvent.submit(homeSearch);
    expect(await screen.findByRole("heading", { name: "상품 검색" })).toBeVisible();
    expect(new URLSearchParams(window.location.search).get("q")).toBe("카메라 + 렌즈");
    expect(screen.getByRole("searchbox")).toHaveValue("카메라 + 렌즈");
  });

  it("shows one global search on other routes and keeps its validation local", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json({ items: [], nextCursor: null }));
    window.history.replaceState({}, "", "/unknown");
    render(<App configResult={validConfig} />);
    const header = within(screen.getByRole("banner"));
    const search = header.getByRole("search", { name: "전체 경매 검색" });
    fireEvent.change(within(search).getByRole("searchbox"), { target: { value: "가".repeat(101) } });
    fireEvent.submit(search);
    expect(within(search).getByRole("alert")).toHaveTextContent("100자 이하");
    expect(window.location.pathname).toBe("/unknown");
    fireEvent.change(within(search).getByRole("searchbox"), { target: { value: "카메라" } });
    fireEvent.submit(search);
    expect(await screen.findByRole("heading", { name: "상품 검색" })).toBeVisible();
    expect(screen.getAllByRole("searchbox")).toHaveLength(1);
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
