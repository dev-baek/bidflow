export type ApiClient = Readonly<{
  get<T>(path: string): Promise<T>;
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
    async get<T>(path: string): Promise<T> {
      const response = await request(joinApiUrl(baseUrl, path), {
        headers: { accept: "application/json" },
      });

      if (!response.ok) {
        throw new ApiError(response.status);
      }

      return response.json() as Promise<T>;
    },
  };
}
