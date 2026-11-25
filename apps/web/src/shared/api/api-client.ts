export type ApiClient = Readonly<{
  get<T>(path: string, headers?: Record<string, string>): Promise<T>;
  post<T>(path: string, body: unknown, headers?: Record<string, string>): Promise<T>;
}>;

export type AccessTokenSource = Readonly<{
  token(): string | undefined;
  unauthorized(): void;
}>;

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`API request failed with status ${status}`);
    this.name = "ApiError";
    this.status = status;
  }
}

export function joinApiUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
}

export function createApiClient(baseUrl: string, request: typeof fetch): ApiClient {
  return {
    async get<T>(path: string, headers: Record<string, string> = {}): Promise<T> {
      const response = await request(joinApiUrl(baseUrl, path), {
        headers: { accept: "application/json", ...headers },
      });

      if (!response.ok) {
        throw new ApiError(response.status);
      }

      return response.json() as Promise<T>;
    },
    async post<T>(path: string, body: unknown, headers: Record<string, string> = {}): Promise<T> {
      const response = await request(joinApiUrl(baseUrl, path), {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json", ...headers },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new ApiError(response.status);
      return response.json() as Promise<T>;
    },
  };
}

export function createProtectedApiClient(baseUrl: string, request: typeof fetch, access: AccessTokenSource): ApiClient {
  return createApiClient(baseUrl, async (input, init) => {
    const base = new URL(baseUrl);
    const url = new URL(String(input));
    if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash || url.origin !== base.origin) {
      throw new Error("Invalid protected API destination");
    }
    const token = access.token();
    if (!token) throw new ApiError(401);
    const headers = new Headers(init?.headers);
    headers.delete("X-Actor-Id");
    headers.set("Authorization", `Bearer ${token}`);
    const response = await request(url.href, { ...init, headers, credentials: "omit", redirect: "error" });
    if (response.status === 401) access.unauthorized();
    return response;
  });
}
