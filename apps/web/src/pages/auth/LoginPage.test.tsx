import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { AuthProvider } from "../../features/auth/auth-context";
import { LoginPage } from "./LoginPage";

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
  });
});
