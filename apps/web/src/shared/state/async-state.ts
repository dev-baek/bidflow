export type AsyncState<T> =
  | { readonly status: "idle" }
  | { readonly status: "loading" }
  | { readonly status: "success"; readonly data: T }
  | { readonly status: "empty" }
  | { readonly status: "error"; readonly message: string };

export type AsyncEvent<T> =
  | { readonly type: "load" | "retry" }
  | { readonly type: "succeed"; readonly data: T }
  | { readonly type: "fail"; readonly message: string };

export function initialAsyncState<T>(): AsyncState<T> {
  return { status: "idle" };
}

export function reduceAsyncState<T>(
  _state: AsyncState<T>,
  event: AsyncEvent<T>,
): AsyncState<T> {
  if (event.type === "load" || event.type === "retry") {
    return { status: "loading" };
  }
  if (event.type === "fail") {
    return { status: "error", message: event.message };
  }
  if (Array.isArray(event.data) && event.data.length === 0) {
    return { status: "empty" };
  }
  return { status: "success", data: event.data };
}
