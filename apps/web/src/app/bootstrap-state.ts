import type { RuntimeConfig } from "../shared/config/runtime-config";

export type BootstrapState =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly config: RuntimeConfig }
  | { readonly status: "error"; readonly message: string };

export type BootstrapEvent =
  | { readonly type: "configLoaded"; readonly config: RuntimeConfig }
  | { readonly type: "configFailed"; readonly message: string }
  | { readonly type: "retry" };

export const initialBootstrapState: BootstrapState = { status: "loading" };

export function bootstrapReducer(
  _state: BootstrapState,
  event: BootstrapEvent,
): BootstrapState {
  if (event.type === "configLoaded") {
    return { status: "ready", config: event.config };
  }
  if (event.type === "configFailed") {
    return { status: "error", message: event.message };
  }
  return { status: "loading" };
}
