import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Button } from "./Button";
import { Field } from "./Field";

afterEach(cleanup);

it("uses a native button and submits only when explicitly requested", () => {
  const submit = vi.fn((event: React.FormEvent) => event.preventDefault());
  render(<form onSubmit={submit}>
    <Button variant="ghost" size="sm">초기화</Button>
    <Button type="submit" variant="secondary" size="lg">등록</Button>
  </form>);
  const reset = screen.getByRole("button", { name: "초기화" });
  const save = screen.getByRole("button", { name: "등록" });
  expect(reset).toHaveClass("ui-button--ghost", "ui-button--sm");
  expect(save).toHaveClass("ui-button--secondary", "ui-button--lg");
  fireEvent.click(reset);
  expect(submit).not.toHaveBeenCalled();
  fireEvent.click(save);
  expect(submit).toHaveBeenCalledTimes(1);
});

it("shows the pending label and blocks pending or disabled actions", () => {
  const click = vi.fn();
  const { rerender } = render(<Button pendingLabel="등록 중" onClick={click}>등록</Button>);
  const pending = screen.getByRole("button", { name: "등록 중" });
  expect(pending).toHaveClass("ui-button--primary", "ui-button--md");
  expect(pending).toBeDisabled();
  expect(pending).toHaveAttribute("aria-busy", "true");
  fireEvent.click(pending);
  rerender(<Button disabled onClick={click}>등록</Button>);
  const disabled = screen.getByRole("button", { name: "등록" });
  expect(disabled).toBeDisabled();
  expect(disabled).not.toHaveAttribute("aria-busy");
  fireEvent.click(disabled);
  expect(click).not.toHaveBeenCalled();
});

it("associates a field label, help, and error with a native selectable control", () => {
  const renderSelect = (props: Parameters<React.ComponentProps<typeof Field>["children"]>[0]) =>
    <select {...props}><option>기타</option></select>;
  const { rerender } = render(<Field id="category" label="카테고리" description="하나를 선택하세요" error="필수 항목입니다">
    {renderSelect}
  </Field>);
  const select = screen.getByRole("combobox", { name: "카테고리" });
  expect(select).toHaveAccessibleDescription("하나를 선택하세요 필수 항목입니다");
  expect(select).toHaveAttribute("aria-invalid", "true");
  expect(screen.getByRole("alert")).toHaveTextContent("필수 항목입니다");
  rerender(<Field id="category" label="카테고리">{renderSelect}</Field>);
  expect(select).not.toHaveAttribute("aria-invalid");
  expect(select).not.toHaveAttribute("aria-describedby");
});
