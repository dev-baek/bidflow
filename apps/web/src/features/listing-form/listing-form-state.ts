export type ImageUploadStatus = "PENDING" | "UPLOADING" | "UPLOADED" | "FAILED";

export type ListingImage = Readonly<{
  localId: string;
  fileName: string;
  contentType: string;
  size: number;
  status: ImageUploadStatus;
  uploadId?: string;
  objectKey?: string;
  errorCode?: string;
}>;

export type ListingDraft = Readonly<{
  title: string;
  description: string;
  categoryId: string;
  conditionGrade: string;
  startingPrice: string;
  startsAt: string;
  endsAt: string;
  images: readonly ListingImage[];
}>;

export type ListingField = keyof Omit<ListingDraft, "images"> | "images";
export type ListingErrors = Readonly<Partial<Record<ListingField, string>>>;
export type ListingFormMode =
  | "EDITING"
  | "UPLOADING_IMAGES"
  | "VALIDATION_ERROR"
  | "SUBMITTING"
  | "SUCCEEDED"
  | "SUBMIT_ERROR";

export type ListingFormState = Readonly<{
  mode: ListingFormMode;
  idempotencyKey: string;
  draft: ListingDraft;
  errors: ListingErrors;
}>;

export type ListingFormAction =
  | Readonly<{ type: "FIELD_CHANGED"; field: Exclude<ListingField, "images">; value: string }>
  | Readonly<{ type: "IMAGES_SELECTED"; images: readonly ListingImage[] }>
  | Readonly<{ type: "IMAGE_UPLOAD_STARTED"; localId: string }>
  | Readonly<{ type: "IMAGE_UPLOAD_COMPLETED"; localId: string; uploadId: string; objectKey: string }>
  | Readonly<{ type: "IMAGE_UPLOAD_FAILED"; localId: string; errorCode: string }>
  | Readonly<{ type: "IMAGE_REMOVED"; localId: string }>
  | Readonly<{ type: "SUBMIT_REQUESTED"; now: Date }>;

const initialDraft: ListingDraft = {
  title: "",
  description: "",
  categoryId: "",
  conditionGrade: "",
  startingPrice: "",
  startsAt: "",
  endsAt: "",
  images: [],
};

const allowedConditionGrades = new Set(["NEW", "LIKE_NEW", "GOOD", "FAIR", "POOR"]);
const tenMinutesInMilliseconds = 10 * 60 * 1000;
const fourteenDaysInMilliseconds = 14 * 24 * 60 * 60 * 1000;

export function createListingFormState(
  idempotencyKey: string,
  draft: ListingDraft = initialDraft,
): ListingFormState {
  return {
    mode: "EDITING",
    idempotencyKey,
    draft,
    errors: {},
  };
}

export function listingFormReducer(
  state: ListingFormState,
  action: ListingFormAction,
): ListingFormState {
  switch (action.type) {
    case "FIELD_CHANGED":
      return withDraft(state, { ...state.draft, [action.field]: action.value });
    case "IMAGES_SELECTED":
      return withDraft(state, { ...state.draft, images: action.images });
    case "IMAGE_UPLOAD_STARTED":
      return withImages(state, action.localId, (image) => ({ ...image, status: "UPLOADING", errorCode: undefined }));
    case "IMAGE_UPLOAD_COMPLETED":
      return withImages(state, action.localId, (image) => ({
        ...image,
        status: "UPLOADED",
        uploadId: action.uploadId,
        objectKey: action.objectKey,
        errorCode: undefined,
      }));
    case "IMAGE_UPLOAD_FAILED":
      return withImages(state, action.localId, (image) => ({ ...image, status: "FAILED", errorCode: action.errorCode }));
    case "IMAGE_REMOVED":
      return withDraft(state, { ...state.draft, images: state.draft.images.filter((image) => image.localId !== action.localId) });
    case "SUBMIT_REQUESTED": {
      const errors = validateListingDraft(state.draft, action.now);
      return Object.keys(errors).length === 0
        ? { ...state, mode: "SUBMITTING", errors: {} }
        : { ...state, mode: "VALIDATION_ERROR", errors };
    }
  }
}

export function validateListingDraft(draft: ListingDraft, now: Date): ListingErrors {
  const errors: Partial<Record<ListingField, string>> = {};
  const title = draft.title.trim();
  const description = draft.description.trim();
  const start = parseUtcDateTime(draft.startsAt);
  const end = parseUtcDateTime(draft.endsAt);

  if (title.length < 2 || title.length > 100) {
    errors.title = "제목은 2자 이상 100자 이하여야 합니다.";
  }
  if (description.length < 10 || description.length > 5000) {
    errors.description = "설명은 10자 이상 5,000자 이하여야 합니다.";
  }
  if (draft.categoryId.trim().length === 0) {
    errors.categoryId = "카테고리를 선택하세요.";
  }
  if (!allowedConditionGrades.has(draft.conditionGrade)) {
    errors.conditionGrade = "상품 상태를 선택하세요.";
  }
  if (!/^\d+$/.test(draft.startingPrice) || Number(draft.startingPrice) < 1000) {
    errors.startingPrice = "시작가는 1,000원 이상의 정수여야 합니다.";
  }
  if (start === undefined || start.getTime() < now.getTime() + tenMinutesInMilliseconds) {
    errors.startsAt = "시작 시각은 현재 기준 10분 뒤부터 설정할 수 있습니다.";
  }
  if (
    start === undefined ||
    end === undefined ||
    end.getTime() - start.getTime() < tenMinutesInMilliseconds
  ) {
    errors.endsAt = "종료 시각은 시작 후 10분 이상이어야 합니다.";
  } else if (end.getTime() - start.getTime() > fourteenDaysInMilliseconds) {
    errors.endsAt = "경매 기간은 14일 이하여야 합니다.";
  }
  if (draft.images.length < 1 || draft.images.length > 10) {
    errors.images = "이미지는 1장 이상 10장 이하로 등록하세요.";
  } else if (draft.images.some((image) => image.status !== "UPLOADED")) {
    errors.images = "모든 이미지 업로드가 완료되어야 합니다.";
  }

  return errors;
}

function withDraft(state: ListingFormState, draft: ListingDraft): ListingFormState {
  return { ...state, mode: "EDITING", draft, errors: {} };
}

function withImages(
  state: ListingFormState,
  localId: string,
  update: (image: ListingImage) => ListingImage,
): ListingFormState {
  return withDraft(state, {
    ...state.draft,
    images: state.draft.images.map((image) => (image.localId === localId ? update(image) : image)),
  });
}

function parseUtcDateTime(value: string): Date | undefined {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) {
    return undefined;
  }
  const date = new Date(`${value}:00Z`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}
