import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "./App";

const validConfig = {
  ok: true as const,
  value: {
    apiBaseUrl: "https://api.bidflow.example",
    wsBaseUrl: "wss://api.bidflow.example/ws",
  },
};

describe("App", () => {
  afterEach(() => {
    window.history.replaceState({}, "", "/");
  });

  it("renders an accessible application landmark when configuration is valid", () => {
    render(<App configResult={validConfig} />);

    expect(screen.getByRole("main")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "BidFlow" })).toBeInTheDocument();
  });

  it("shows a configuration error instead of a blank page", () => {
    render(
      <App
        configResult={{
          ok: false,
          message: "VITE_API_BASE_URL 설정을 확인하세요.",
        }}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "VITE_API_BASE_URL 설정을 확인하세요.",
    );
  });

  it("shows a not-found page for an unknown route", () => {
    window.history.replaceState({}, "", "/unknown");

    render(<App configResult={validConfig} />);

    expect(
      screen.getByRole("heading", { name: "페이지를 찾을 수 없습니다" }),
    ).toBeInTheDocument();
  });
});
