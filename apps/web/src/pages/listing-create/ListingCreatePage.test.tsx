import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ListingCreatePage } from "./ListingCreatePage";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("ListingCreatePage", () => {
  it("shows accessible field errors instead of submitting an incomplete form", () => {
    render(<ListingCreatePage now={() => new Date("2026-11-12T00:00:00Z")} />);

    fireEvent.click(screen.getByRole("button", { name: "상품 등록" }));

    expect(screen.getByRole("alert")).toHaveTextContent("제목은 2자 이상 100자 이하여야 합니다.");
    expect(screen.getByLabelText("상품 제목")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getAllByText("이미지는 1장 이상 10장 이하로 등록하세요.")).toHaveLength(2);
  });

  it("authenticates presign and listing creation but not the object storage PUT", async () => {
    const request = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({
        uploadId: "upload-1", objectKey: "image.png", uploadUrl: "https://storage.example.test/presigned",
        requiredHeaders: { "Content-Type": "image/png", aUtHoRiZaTiOn: "never-forward", "X-Actor-Id": "local-id" },
      }))
      .mockResolvedValueOnce(Response.json({ auctionId: "auction-1" }));
    vi.stubGlobal("fetch", request);
    const upload = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 200 }));
    render(<ListingCreatePage apiBaseUrl="https://api.example.test" now={() => new Date("2030-01-01T00:00:00Z")}
      cognitoAccess={{ token: () => "access-token", unauthorized: vi.fn() }} upload={upload} />);

    for (const [label, value] of [["상품 제목", "경매 카메라"], ["상품 설명", "정상 동작하는 카메라를 판매합니다."],
      ["카테고리", "DIGITAL"], ["상품 상태", "GOOD"], ["시작가 (원)", "10000"],
      ["시작 시각 (UTC)", "2030-01-02T00:00"], ["종료 시각 (UTC)", "2030-01-03T00:00"]]) {
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
    }
    fireEvent.change(screen.getByLabelText("이미지"), {
      target: { files: [new File(["test"], "image.png", { type: "image/png" })] },
    });
    expect(await screen.findByText("image.png — UPLOADED")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "상품 등록" }));
    expect(await screen.findByText("등록했습니다. 경매 ID: auction-1")).toBeVisible();
    expect(request.mock.calls.map(([url]) => url)).toEqual([
      "https://api.example.test/api/v1/uploads/presign", "https://api.example.test/api/v1/listings",
    ]);
    for (const [, init] of request.mock.calls) {
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer access-token");
    }
    expect(upload).toHaveBeenCalledWith("https://storage.example.test/presigned", expect.objectContaining({ method: "PUT", credentials: "omit" }));
    expect([...new Headers(upload.mock.calls[0]![1]?.headers)]).toEqual([["content-type", "image/png"]]);
  });
});
