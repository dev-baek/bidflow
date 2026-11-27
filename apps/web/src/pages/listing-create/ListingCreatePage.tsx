import { useEffect, useMemo, useReducer, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { Link } from "react-router-dom";
import {
  createListingFormState,
  listingImageAccept,
  listingImageLimit,
  listingFormReducer,
  type ListingField,
  type ListingImage,
  validateListingDraft,
  validatePhotoSelection,
} from "../../features/listing-form/listing-form-state";
import { createApiClient, createProtectedApiClient, type AccessTokenSource, type ApiClient } from "../../shared/api/api-client";
import { Button } from "../../shared/ui/Button";
import { StatusMessage } from "../../shared/ui/Feedback";
import { Field } from "../../shared/ui/Field";
import { PageLayout } from "../../shared/ui/PageLayout";

export type ListingCreatePageProps = Readonly<{
  now?: () => Date;
  apiBaseUrl?: string;
  localActorId?: string;
  cognitoAccess?: AccessTokenSource;
  client?: ApiClient;
  upload?: typeof fetch;
}>;

type PresignedUpload = Readonly<{ uploadId: string; objectKey: string; uploadUrl: string; requiredHeaders: Record<string, string> }>;
type ListingResponse = Readonly<{ auctionId: string }>;

const categories = [
  ["DIGITAL", "디지털·가전"],
  ["FASHION", "패션"],
  ["HOBBY", "취미·컬렉션"],
  ["LIVING", "생활·가구"],
] as const;

const conditionGrades = [
  ["NEW", "새 상품"],
  ["LIKE_NEW", "거의 새 상품"],
  ["GOOD", "좋음"],
  ["FAIR", "보통"],
  ["POOR", "사용감 많음"],
] as const;

const photoStatuses = {
  PENDING: "업로드 대기",
  UPLOADING: "업로드 중",
  UPLOADED: "업로드 완료",
  FAILED: "업로드 실패",
} satisfies Record<ListingImage["status"], string>;

export function ListingCreatePage({ now = () => new Date(), apiBaseUrl = "", localActorId, cognitoAccess, client, upload = fetch }: ListingCreatePageProps) {
  const [state, dispatch] = useReducer(
    listingFormReducer,
    undefined,
    () => createListingFormState(createIdempotencyKey()),
  );
  const form = useRef<HTMLFormElement>(null);
  const submitLocked = useRef(false);
  const files = useRef(new Map<string, File>());
  const [selectionError, setSelectionError] = useState<string>();
  const defaultClient = useMemo(() => cognitoAccess ? createProtectedApiClient(apiBaseUrl, fetch, cognitoAccess)
    : createApiClient(apiBaseUrl, fetch), [apiBaseUrl, cognitoAccess]);
  const resolvedClient = client ?? defaultClient;
  const actorHeaders: Record<string, string> = !cognitoAccess && localActorId ? { "X-Actor-Id": localActorId } : {};

  const changeField = (field: Exclude<ListingField, "images">) => (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    dispatch({ type: "FIELD_CHANGED", field, value: event.target.value });
  };

  const selectImages = (event: ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = "";
    if (selected.length === 0) return;
    const error = validatePhotoSelection(selected, state.draft.images.length);
    setSelectionError(error);
    if (error) return;

    const images: ListingImage[] = selected.map((file) => {
      const localId = createIdempotencyKey();
      files.current.set(localId, file);
      return { localId, fileName: file.name, contentType: file.type, size: file.size, status: "PENDING" };
    });
    dispatch({ type: "IMAGES_SELECTED", images });
    if (cognitoAccess || localActorId) images.forEach((image) => void uploadImage(image.localId));
  };

  const removePhoto = (localId: string) => {
    files.current.delete(localId);
    setSelectionError(undefined);
    dispatch({ type: "IMAGE_REMOVED", localId });
  };
  const submitting = state.mode === "SUBMITTING";
  const completed = state.mode === "SUCCEEDED";
  const formLocked = submitting || completed;
  const photosError = selectionError ?? state.errors.images;

  useEffect(() => {
    if (state.mode === "VALIDATION_ERROR") {
      form.current?.querySelector<HTMLElement>('[aria-invalid="true"]:not(:disabled)')?.focus();
    }
  }, [state.mode, state.errors]);

  const uploadImage = async (localId: string) => {
    const file = files.current.get(localId);
    if (!file) return;
    dispatch({ type: "IMAGE_UPLOAD_STARTED", localId });
    try {
      const presigned = await resolvedClient.post<PresignedUpload>("/api/v1/uploads/presign", { contentType: file.type, contentLength: file.size }, actorHeaders);
      try {
        if (cognitoAccess && !cognitoAccess.token()) throw new Error("session ended");
        const headers = cognitoAccess ? new Headers(presigned.requiredHeaders) : presigned.requiredHeaders;
        if (headers instanceof Headers) {
          headers.delete("Authorization");
          headers.delete("X-Actor-Id");
        }
        const response = await upload(presigned.uploadUrl, { method: "PUT", headers, body: file, ...(cognitoAccess ? { credentials: "omit" } : {}) });
        if (!response.ok) throw new Error("upload failed");
        dispatch({ type: "IMAGE_UPLOAD_COMPLETED", localId, uploadId: presigned.uploadId, objectKey: presigned.objectKey });
      } catch { dispatch({ type: "IMAGE_UPLOAD_FAILED", localId, errorCode: "OBJECT_UPLOAD_FAILED" }); }
    } catch { dispatch({ type: "IMAGE_UPLOAD_FAILED", localId, errorCode: "PRESIGN_FAILED" }); }
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitLocked.current) return;
    const currentNow = now();
    const errors = validateListingDraft(state.draft, currentNow);
    dispatch({ type: "SUBMIT_REQUESTED", now: currentNow });
    if (Object.keys(errors).length > 0 || (!cognitoAccess && !localActorId)) return;
    submitLocked.current = true;
    void resolvedClient.post<ListingResponse>("/api/v1/listings", {
      title: state.draft.title, description: state.draft.description, categoryId: state.draft.categoryId,
      conditionGrade: state.draft.conditionGrade, startingPrice: Number(state.draft.startingPrice),
      startsAt: `${state.draft.startsAt}:00Z`, endsAt: `${state.draft.endsAt}:00Z`,
      images: state.draft.images.map((image) => ({ uploadId: image.uploadId })),
    }, { "Idempotency-Key": state.idempotencyKey, ...actorHeaders })
      .then((result) => dispatch({ type: "SUBMIT_SUCCEEDED", auctionId: result.auctionId }))
      .catch(() => {
        submitLocked.current = false;
        dispatch({ type: "SUBMIT_FAILED" });
      });
  };

  return (
    <PageLayout width="form">
      <form className="listing-create-form" ref={form} noValidate onSubmit={submit} aria-labelledby="listing-create-title">
        <h1 id="listing-create-title">상품 등록</h1>

        <section className="listing-photos" aria-labelledby="listing-photos-title">
          <h2 id="listing-photos-title">사진</h2>
          <p id="listing-photos-help" className="listing-photos-help">JPEG·PNG·WebP, 각 10 MiB 이하 · {state.draft.images.length}/{listingImageLimit}장</p>
          {photosError && <p id="listing-photos-error" className="ui-field__error" role="alert">{photosError}</p>}
          <ul className="listing-photo-grid" role="list" aria-label="출품 사진">
              <li className="listing-photo-picker">
                <label htmlFor="listing-images">사진 추가<span aria-hidden="true" /></label>
                <input id="listing-images" type="file" accept={listingImageAccept} multiple onChange={selectImages}
                  disabled={formLocked || state.draft.images.length >= listingImageLimit}
                  aria-invalid={Boolean(photosError)} aria-describedby={photosError ? "listing-photos-help listing-photos-error" : "listing-photos-help"} />
              </li>
              {state.draft.images.map((image, index) => (
                <li className="listing-photo" key={image.localId}>
                  <div className="listing-photo-media">
                    <PhotoPreview file={files.current.get(image.localId)} />
                    {index === 0 && <span className="listing-photo-cover">대표 사진</span>}
                  </div>
                  <p className="listing-photo-name">{image.fileName}</p>
                  <p data-status={image.status} className="listing-photo-status" aria-live="polite">{photoStatuses[image.status]}</p>
                  {image.status === "FAILED" && (
                    <Button variant="secondary" disabled={formLocked} aria-label={`${image.fileName} 다시 시도`}
                      onClick={() => void uploadImage(image.localId)}>다시 시도</Button>
                  )}
                  <Button variant="ghost" disabled={formLocked || image.status === "UPLOADING"}
                    aria-label={`${image.fileName} 삭제`} onClick={() => removePhoto(image.localId)}>삭제</Button>
                </li>
              ))}
          </ul>
        </section>

        <fieldset className="listing-create-section" disabled={formLocked}>
          <legend>상품 정보</legend>
          <div className="listing-create-fields">
            <Field id="listing-title" label="상품 제목" error={state.errors.title}>
              {(control) => <input {...control} value={state.draft.title} onChange={changeField("title")} />}
            </Field>
            <div className="listing-create-pair">
              <Field id="listing-category" label="카테고리" error={state.errors.categoryId}>
                {(control) => <select {...control} value={state.draft.categoryId} onChange={changeField("categoryId")}>
                  <option value="">선택하세요</option>
                  {categories.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>}
              </Field>
              <Field id="listing-condition" label="상품 상태" error={state.errors.conditionGrade}>
                {(control) => <select {...control} value={state.draft.conditionGrade} onChange={changeField("conditionGrade")}>
                  <option value="">선택하세요</option>
                  {conditionGrades.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>}
              </Field>
            </div>
            <Field id="listing-description" label="상품 설명" error={state.errors.description}>
              {(control) => <textarea {...control} value={state.draft.description} onChange={changeField("description")} rows={3} />}
            </Field>
          </div>
        </fieldset>

        <fieldset className="listing-create-section" disabled={formLocked}>
          <legend>경매 조건</legend>
          <div className="listing-create-fields">
            <Field id="listing-starting-price" label="시작가 (원)" error={state.errors.startingPrice}>
              {(control) => <input {...control} type="number" min="1000" step="1" value={state.draft.startingPrice} onChange={changeField("startingPrice")} />}
            </Field>
            <div className="listing-create-pair">
              <Field id="listing-starts-at" label="시작 시각 (UTC)" error={state.errors.startsAt}>
                {(control) => <input {...control} type="datetime-local" step={60} value={state.draft.startsAt} onChange={changeField("startsAt")} />}
              </Field>
              <Field id="listing-ends-at" label="마감 시각 (UTC)" error={state.errors.endsAt}>
                {(control) => <input {...control} type="datetime-local" step={60} value={state.draft.endsAt} onChange={changeField("endsAt")} />}
              </Field>
            </div>
          </div>
        </fieldset>

        <div className="listing-create-actions">
          {state.mode === "SUBMIT_ERROR" && <StatusMessage kind="error">등록 요청에 실패했어요. 입력한 내용은 그대로 유지됩니다. 다시 시도하세요.</StatusMessage>}
          {completed && state.auctionId ? (
            <>
              <StatusMessage kind="success">상품을 등록했어요.</StatusMessage>
              <Link className="ui-button ui-button--primary ui-button--md" to={`/auctions/${encodeURIComponent(state.auctionId)}`}>경매 상세 보기</Link>
            </>
          ) : (
            <Button type="submit" disabled={formLocked} pendingLabel={submitting ? "등록 중…" : undefined}>상품 등록</Button>
          )}
        </div>
      </form>
    </PageLayout>
  );
}

function PhotoPreview({ file }: Readonly<{ file?: File }>) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!file || !URL.createObjectURL) return;
    const previewUrl = URL.createObjectURL(file);
    setUrl(previewUrl);
    return () => URL.revokeObjectURL(previewUrl);
  }, [file]);
  return file && url ? <img src={url} alt={`${file.name} 미리보기`} /> : null;
}

function createIdempotencyKey(): string {
  return globalThis.crypto.randomUUID();
}
