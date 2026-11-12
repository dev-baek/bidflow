# [Issue #48] 상품 등록 폼·화면 상태 검증 보고서

- 상태: 완료
- 작성일: 2026-11-12
- 관련 사양: [상품 등록 화면·API·이미지 업로드](../specs/issue-046-listing-registration.md)
- 관련 Issue: [#48 상품 등록 폼과 입력 검증](https://github.com/dev-baek/bidflow/issues/48)

## 구현 범위

- `/listings/new`에 상품 제목·설명·카테고리·상태·이미지·시작가·시작/종료 시각 입력 화면을 추가했다.
- 화면 상태는 `listingFormReducer`가 관리한다. Reducer에는 `File`, `AbortController`, `Date.now`, 네트워크 호출을 넣지 않았다.
- 화면 Event Handler가 파일 객체를 메타데이터로 변환하고, 제출 시 서버 시각을 대신하는 `now`를 Reducer에 전달한다.
- 시작·종료 입력은 UTC임을 명시하고 UTC로 파싱한다. Browser 시간대에 따라 경계 결과가 달라지지 않는다.

## 상태와 후속 경계

| 현재 상태 | 의미 | 다음 작업 |
|---|---|---|
| `PENDING` | 사용자가 파일을 선택했지만 업로드 URL 요청 전 | #49 API Client가 Presign 요청 시작 |
| `UPLOADING` | Presigned PUT 진행 중 | #49가 네트워크 효과와 진행률 연결 |
| `UPLOADED` | `uploadId`, `objectKey` 확보 | #49 등록 요청 Body에 참조 |
| `FAILED` | 업로드 실패 | #49가 재시도 Action 연결 |

현재 #48은 API가 없는 상태에서 `PENDING` 이미지의 등록 제출을 차단한다. 파일을 선택했다고 업로드 완료로 처리하지 않으며, #49가 #47의 Presigned URL Adapter와 화면을 연결할 때만 `UPLOADED` 전이가 가능하다.

## TDD 증적

1. Reducer·화면이 없는 상태에서 Test가 모듈을 찾지 못해 실패했다(RED).
2. 필드 검증, 이미지 상태 전이, 제출 차단을 순수 함수로 구현했다.
3. 오류 요약 Alert와 필드별 `aria-invalid` 표시를 추가했다.
4. 상태 Test와 화면 Test가 통과했다(GREEN).

## 검증

- Reducer: 최소 시작가·10분 경계·이미지 완료 여부·멱등 Key 보존
- Reducer: 제목·설명·카테고리·가격·기간·이미지 오류
- 화면: 불완전한 폼 제출 시 오류 요약과 필드 오류 표시
- 전체 Vitest: 24개 통과
- Vite Production Build 통과
