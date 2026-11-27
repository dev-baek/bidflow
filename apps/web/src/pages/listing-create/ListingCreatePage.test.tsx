import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ListingCreatePage } from "./ListingCreatePage";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("ListingCreatePage", () => {
  it("previews photos in selection order and releases previews when removed", () => {
    const createObjectURL = vi.fn(() => "blob:preview");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", Object.assign(class extends URL {}, { createObjectURL, revokeObjectURL }));
    const { unmount } = render(<ListingCreatePage />);
    const input = screen.getByLabelText("사진 추가");
    expect(input.compareDocumentPosition(screen.getByLabelText("상품 제목")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    for (const name of ["front.png", "back.png"]) {
      fireEvent.change(input, { target: { files: [new File(["test"], name, { type: "image/png" })] } });
    }

    const [, first, second] = within(screen.getByRole("list", { name: "출품 사진" })).getAllByRole("listitem");
    expect(within(first!).getByText("대표 사진")).toBeVisible();
    expect(within(first!).getByRole("img", { name: "front.png 미리보기" })).toHaveAttribute("src", "blob:preview");
    expect(within(second!).queryByText("대표 사진")).not.toBeInTheDocument();
    fireEvent.click(within(first!).getByRole("button", { name: "front.png 삭제" }));
    expect(within(second!).getByText("대표 사진")).toBeVisible();
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
    unmount();
    expect(revokeObjectURL).toHaveBeenCalledTimes(2);
  });

  it("retries only a failed photo without replacing the successful one", async () => {
    const request = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({
      uploadId: "upload", objectKey: "photo.png", uploadUrl: "https://storage.example.test/presigned",
      requiredHeaders: {},
    }));
    vi.stubGlobal("fetch", request);
    const upload = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    render(<ListingCreatePage apiBaseUrl="https://api.example.test" localActorId="seller" upload={upload} />);
    fireEvent.change(screen.getByLabelText("사진 추가"), { target: { files: [
      new File(["front"], "camera.png", { type: "image/png" }),
      new File(["back"], "camera.png", { type: "image/png" }),
    ] } });

    const [, first, second] = within(screen.getByRole("list", { name: "출품 사진" })).getAllByRole("listitem");
    expect(await within(first!).findByText("업로드 완료")).toBeVisible();
    expect(await within(second!).findByText("업로드 실패")).toBeVisible();
    expect(upload.mock.calls[0]![1]?.body).not.toBe(upload.mock.calls[1]![1]?.body);
    fireEvent.click(within(second!).getByRole("button", { name: "camera.png 다시 시도" }));
    expect(await within(second!).findByText("업로드 완료")).toBeVisible();
    expect(within(first!).getByText("대표 사진")).toBeVisible();
    expect(upload).toHaveBeenCalledTimes(3);
    expect(upload.mock.calls[2]![1]?.body).toBe(upload.mock.calls[1]![1]?.body);
  });

  it("rejects invalid files and an over-limit batch before making upload requests", () => {
    const request = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", request);
    render(<ListingCreatePage localActorId="seller" />);
    const input = screen.getByLabelText("사진 추가");
    fireEvent.change(input, { target: { files: [new File(["test"], "not-photo.txt", { type: "text/plain" })] } });
    expect(screen.getByRole("alert")).toHaveTextContent("JPEG·PNG·WebP");
    fireEvent.change(input, { target: { files: Array.from({ length: 11 }, () => new File(["test"], "photo.png", { type: "image/png" })) } });
    expect(screen.getByRole("alert")).toHaveTextContent("최대 10장");
    expect(request).not.toHaveBeenCalled();
  });

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
      ["시작 시각 (UTC)", "2030-01-02T00:00"], ["종료 시각 (UTC)", "2030-01-03T00:00"]] as const) {
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
    }
    fireEvent.change(screen.getByLabelText("사진 추가"), {
      target: { files: [new File(["test"], "image.png", { type: "image/png" })] },
    });
    expect(await screen.findByText("업로드 완료")).toBeVisible();
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
