import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ListingCreatePage } from "./ListingCreatePage";

describe("ListingCreatePage", () => {
  it("shows accessible field errors instead of submitting an incomplete form", () => {
    render(<ListingCreatePage now={() => new Date("2026-11-12T00:00:00Z")} />);

    fireEvent.click(screen.getByRole("button", { name: "상품 등록" }));

    expect(screen.getByRole("alert")).toHaveTextContent("제목은 2자 이상 100자 이하여야 합니다.");
    expect(screen.getByLabelText("상품 제목")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("이미지는 1장 이상 10장 이하로 등록하세요.")).toBeInTheDocument();
  });
});
