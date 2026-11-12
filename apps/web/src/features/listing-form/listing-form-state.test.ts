import { describe, expect, it } from "vitest";
import {
  createListingFormState,
  listingFormReducer,
  validateListingDraft,
  type ListingDraft,
} from "./listing-form-state";

const now = new Date("2026-11-12T00:00:00Z");

function validDraft(overrides: Partial<ListingDraft> = {}): ListingDraft {
  return {
    title: "중고 카메라",
    description: "정상 동작하는 미러리스 카메라입니다.",
    categoryId: "DIGITAL",
    conditionGrade: "GOOD",
    startingPrice: "50000",
    startsAt: "2026-11-12T00:10",
    endsAt: "2026-11-12T01:10",
    images: [
      {
        localId: "image-1",
        fileName: "camera.jpg",
        contentType: "image/jpeg",
        size: 5,
        status: "UPLOADED",
      },
    ],
    ...overrides,
  };
}

describe("validateListingDraft", () => {
  it("accepts the documented minimum price, period, and completed image", () => {
    const errors = validateListingDraft(
      validDraft({
        startingPrice: "1000",
        endsAt: "2026-11-12T00:20",
      }),
      now,
    );

    expect(errors).toEqual({});
  });

  it("returns field errors for invalid text, price, period, and images", () => {
    const errors = validateListingDraft(
      validDraft({
        title: " ",
        description: "짧음",
        categoryId: "",
        startingPrice: "999.5",
        startsAt: "2026-11-12T00:09",
        endsAt: "2026-11-12T00:09",
        images: [],
      }),
      now,
    );

    expect(errors).toEqual({
      title: "제목은 2자 이상 100자 이하여야 합니다.",
      description: "설명은 10자 이상 5,000자 이하여야 합니다.",
      categoryId: "카테고리를 선택하세요.",
      startingPrice: "시작가는 1,000원 이상의 정수여야 합니다.",
      startsAt: "시작 시각은 현재 기준 10분 뒤부터 설정할 수 있습니다.",
      endsAt: "종료 시각은 시작 후 10분 이상이어야 합니다.",
      images: "이미지는 1장 이상 10장 이하로 등록하세요.",
    });
  });
});

describe("listingFormReducer", () => {
  it("keeps file metadata in state and blocks submission until every image upload completes", () => {
    const selected = listingFormReducer(createListingFormState("request-1"), {
      type: "IMAGES_SELECTED",
      images: [
        {
          localId: "image-1",
          fileName: "camera.jpg",
          contentType: "image/jpeg",
          size: 5,
          status: "PENDING",
        },
      ],
    });
    const submitted = listingFormReducer(selected, {
      type: "SUBMIT_REQUESTED",
      now,
    });

    expect(selected.mode).toBe("EDITING");
    expect(selected.draft.images[0]?.status).toBe("PENDING");
    expect(submitted.mode).toBe("VALIDATION_ERROR");
    expect(submitted.errors.images).toBe("모든 이미지 업로드가 완료되어야 합니다.");
  });

  it("changes only the selected image status after upload completion", () => {
    const state = createListingFormState("request-1", validDraft({
      images: [
        {
          localId: "image-1",
          fileName: "camera.jpg",
          contentType: "image/jpeg",
          size: 5,
          status: "UPLOADING",
        },
        {
          localId: "image-2",
          fileName: "side.png",
          contentType: "image/png",
          size: 5,
          status: "PENDING",
        },
      ],
    }));

    const next = listingFormReducer(state, {
      type: "IMAGE_UPLOAD_COMPLETED",
      localId: "image-1",
      uploadId: "upload-1",
      objectKey: "products/seller-1/upload-1",
    });

    expect(next.draft.images).toEqual([
      expect.objectContaining({ localId: "image-1", status: "UPLOADED", uploadId: "upload-1" }),
      expect.objectContaining({ localId: "image-2", status: "PENDING" }),
    ]);
  });

  it("moves a valid completed form to submitting without replacing its idempotency key", () => {
    const state = createListingFormState("request-1", validDraft());

    const next = listingFormReducer(state, { type: "SUBMIT_REQUESTED", now });

    expect(next.mode).toBe("SUBMITTING");
    expect(next.idempotencyKey).toBe("request-1");
    expect(next.errors).toEqual({});
  });
});
