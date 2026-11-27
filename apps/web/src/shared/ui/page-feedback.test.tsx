import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { Badge, StatusMessage } from "./Feedback";
import { PageLayout } from "./PageLayout";

afterEach(cleanup);

it("gives the page one main landmark with the chosen content width", () => {
  render(<PageLayout width="form"><h1>검색 결과</h1></PageLayout>);
  const main = screen.getByRole("main");
  expect(main).toHaveClass("ui-page--form");
  expect(main).toContainElement(screen.getByRole("heading", { name: "검색 결과" }));
});

it("renders a badge as readable text without a live announcement", () => {
  render(<Badge tone="success">진행 중</Badge>);
  expect(screen.getByText("진행 중")).toHaveClass("ui-tone--success");
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});

it.each([
  ["loading", "info", "status"], ["empty", "neutral", "status"],
  ["success", "success", "status"], ["warning", "warning", "status"], ["error", "error", "alert"],
] as const)("keeps the %s message readable and announces it as %s feedback with role %s", (kind, tone, role) => {
  render(<StatusMessage kind={kind}>화면 안내</StatusMessage>);
  const message = screen.getByRole(role);
  expect(message).toHaveTextContent("화면 안내");
  expect(message).toHaveClass(`ui-tone--${tone}`);
});
