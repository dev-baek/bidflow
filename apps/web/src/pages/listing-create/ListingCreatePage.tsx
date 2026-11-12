import { useReducer, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import {
  createListingFormState,
  listingFormReducer,
  type ListingField,
  type ListingImage,
} from "../../features/listing-form/listing-form-state";

export type ListingCreatePageProps = Readonly<{
  now?: () => Date;
}>;

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

export function ListingCreatePage({ now = () => new Date() }: ListingCreatePageProps) {
  const [state, dispatch] = useReducer(
    listingFormReducer,
    undefined,
    () => createListingFormState(createIdempotencyKey()),
  );

  const changeField = (field: Exclude<ListingField, "images">) => (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    dispatch({ type: "FIELD_CHANGED", field, value: event.target.value });
  };

  const selectImages = (event: ChangeEvent<HTMLInputElement>) => {
    const images: ListingImage[] = Array.from(event.target.files ?? []).map((file) => ({
      localId: createIdempotencyKey(),
      fileName: file.name,
      contentType: file.type,
      size: file.size,
      status: "PENDING",
    }));
    dispatch({ type: "IMAGES_SELECTED", images });
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    dispatch({ type: "SUBMIT_REQUESTED", now: now() });
  };

  return (
    <main className="app-shell listing-shell">
      <form className="listing-form" noValidate onSubmit={submit} aria-labelledby="listing-create-title">
        <p className="eyebrow">SELLER LISTING</p>
        <h1 id="listing-create-title">상품 등록</h1>
        <p className="form-intro">이미지를 먼저 업로드한 뒤, 상품과 경매를 함께 등록합니다.</p>

        {state.mode === "VALIDATION_ERROR" ? (
          <div className="form-alert" role="alert">
            <p>입력값을 확인하세요.</p>
            <ul>
              {Object.values(state.errors).map((error) => <li key={error}>{error}</li>)}
            </ul>
          </div>
        ) : null}

        <FieldError error={state.errors.title}>
          <label htmlFor="listing-title">상품 제목</label>
          <input id="listing-title" value={state.draft.title} onChange={changeField("title")} aria-invalid={Boolean(state.errors.title)} />
        </FieldError>

        <FieldError error={state.errors.description}>
          <label htmlFor="listing-description">상품 설명</label>
          <textarea id="listing-description" value={state.draft.description} onChange={changeField("description")} aria-invalid={Boolean(state.errors.description)} rows={6} />
        </FieldError>

        <div className="form-grid">
          <FieldError error={state.errors.categoryId}>
            <label htmlFor="listing-category">카테고리</label>
            <select id="listing-category" value={state.draft.categoryId} onChange={changeField("categoryId")} aria-invalid={Boolean(state.errors.categoryId)}>
              <option value="">선택하세요</option>
              {categories.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </FieldError>

          <FieldError error={state.errors.conditionGrade}>
            <label htmlFor="listing-condition">상품 상태</label>
            <select id="listing-condition" value={state.draft.conditionGrade} onChange={changeField("conditionGrade")} aria-invalid={Boolean(state.errors.conditionGrade)}>
              <option value="">선택하세요</option>
              {conditionGrades.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </FieldError>
        </div>

        <FieldError error={state.errors.images}>
          <label htmlFor="listing-images">이미지</label>
          <input id="listing-images" type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={selectImages} aria-invalid={Boolean(state.errors.images)} />
          <p className="field-help">JPEG·PNG·WebP, 각 10 MiB 이하, 1~10장</p>
          {state.draft.images.length > 0 ? (
            <ul className="image-list">
              {state.draft.images.map((image) => <li key={image.localId}>{image.fileName} — {image.status}</li>)}
            </ul>
          ) : null}
        </FieldError>

        <div className="form-grid">
          <FieldError error={state.errors.startingPrice}>
            <label htmlFor="listing-starting-price">시작가 (원)</label>
            <input id="listing-starting-price" type="number" min="1000" step="1" value={state.draft.startingPrice} onChange={changeField("startingPrice")} aria-invalid={Boolean(state.errors.startingPrice)} />
          </FieldError>
          <FieldError error={state.errors.startsAt}>
            <label htmlFor="listing-starts-at">시작 시각 (UTC)</label>
            <input id="listing-starts-at" type="datetime-local" value={state.draft.startsAt} onChange={changeField("startsAt")} aria-invalid={Boolean(state.errors.startsAt)} />
          </FieldError>
          <FieldError error={state.errors.endsAt}>
            <label htmlFor="listing-ends-at">종료 시각 (UTC)</label>
            <input id="listing-ends-at" type="datetime-local" value={state.draft.endsAt} onChange={changeField("endsAt")} aria-invalid={Boolean(state.errors.endsAt)} />
          </FieldError>
        </div>

        {state.mode === "SUBMITTING" ? <p className="field-help">등록 요청을 준비했습니다. API 연결은 다음 작업에서 추가합니다.</p> : null}
        <button type="submit" disabled={state.mode === "SUBMITTING"}>상품 등록</button>
      </form>
    </main>
  );
}

function FieldError({ children, error }: Readonly<{ children: ReactNode; error?: string }>) {
  return (
    <div className="form-field">
      {children}
      {error ? <p className="field-error">{error}</p> : null}
    </div>
  );
}

function createIdempotencyKey(): string {
  return globalThis.crypto.randomUUID();
}
