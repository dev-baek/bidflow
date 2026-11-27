import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { AuthProvider } from "../../features/auth/auth-context";
import { LoginPage } from "./LoginPage";
import { RequireAuthenticated } from "./RequireAuthenticated";

afterEach(cleanup);

describe("LoginPage", () => {
  it("shows a local authentication error when the developer ID is missing", () => {
    render(
      <MemoryRouter>
        <AuthProvider>
          <LoginPage />
        </AuthProvider>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "로컬 로그인" }));

    expect(screen.getByRole("alert")).toHaveTextContent("로컬 개발자 ID를 입력하세요.");
    const input = screen.getByRole("textbox", { name: "로컬 개발자 ID" });
    expect(input).toHaveFocus();
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("예: local-seller 로컬 개발자 ID를 입력하세요.");
  });

  it("explains local demo sign-in without exposing implementation terms and keeps the home redirect", async () => {
    render(<MemoryRouter initialEntries={["/listings/new"]}><AuthProvider><Routes>
      <Route path="/" element={<h1>홈</h1>} />
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuthenticated />}>
        <Route path="/listings/new" element={<p>보호된 등록 폼</p>} />
      </Route>
    </Routes></AuthProvider></MemoryRouter>);
    expect(await screen.findByText("상품을 등록하려면 먼저 로그인해 주세요.")).toBeVisible();
    expect(screen.getByText("로컬 데모")).toBeVisible();
    expect(screen.queryByText(/Header adapter|PKCE|#39/)).not.toBeInTheDocument();
    expect(screen.queryByText("보호된 등록 폼")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "경매 둘러보기" })).toHaveAttribute("href", "/listings");
    fireEvent.change(screen.getByRole("textbox", { name: "로컬 개발자 ID" }), { target: { value: "local-seller" } });
    fireEvent.click(screen.getByRole("button", { name: "로컬 로그인" }));
    expect(await screen.findByRole("heading", { name: "홈" })).toBeVisible();
  });
});
