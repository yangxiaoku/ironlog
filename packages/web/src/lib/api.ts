export class ApiError extends Error {
  status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export const READ_ONLY_POST_PATHS = new Set<string>([
  "/api/catalogue/exercises/lookup",
  "/api/catalogue/exercises/details",
  "/api/web/exercise-references",
  "/api/web/exercise-prs",
  "/api/web/import-csv/preview",
  "/api/ai/review",
  "/api/ai/parse-diet",
  "/api/ai/parse-workout",
  "/api/ai/adapt-workout",
]);

interface ApiHooks {
  getDemoToken?: () => string;
  getUserId?: () => string;
  onMutate?: (cleanPath: string) => void;
}

let apiHooks: ApiHooks = {};

export function configureApi(hooks: ApiHooks): void {
  apiHooks = hooks;
}

export interface ApiFetchOptions {
  method?: string;
  body?: unknown;
  token?: string;
  accountId?: string;
  timeout?: number;
  skipMutateHook?: boolean;
}

export async function apiFetch<T = unknown>(
  path: string,
  {
    method = "GET",
    body = undefined,
    token = apiHooks.getDemoToken?.() ?? "",
    accountId = apiHooks.getUserId?.() ?? "",
    timeout = 15000,
    skipMutateHook = false,
  }: ApiFetchOptions = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (accountId) headers["X-Ironlog-Account"] = accountId;
  if (body !== undefined) headers["Content-Type"] = "application/json";

  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    cache: method === "GET" && path.startsWith("/api/catalogue/") ? "default" : "no-store",
    signal: AbortSignal.timeout(timeout),
  });

  const data = (await response.json().catch(() => undefined)) as
    | { error?: string; details?: Array<{ path?: Array<string | number>; message?: string }> }
    | undefined;

  if (!response.ok) {
    const firstDetail = data?.details?.[0];
    const detailPath = Array.isArray(firstDetail?.path) ? firstDetail.path.join(".") : "";
    const detailMsg = firstDetail?.message;
    const msg =
      path.startsWith("/auth/web/")
        ? (detailMsg ?? data?.error ?? "请求失败，请重试")
        : data?.error
          ? detailMsg
            ? `${data.error}（${detailPath ? `${detailPath}: ` : ""}${detailMsg}）`
            : data.error
          : (detailMsg ?? "请求失败，请重试");
    throw new ApiError(msg, response.status);
  }

  if (data === undefined) {
    throw new ApiError("服务器没有返回有效数据");
  }

  const cleanPath = path.split("?")[0] ?? path;
  if (!skipMutateHook && method !== "GET" && !path.startsWith("/auth/") && !READ_ONLY_POST_PATHS.has(cleanPath)) {
    apiHooks.onMutate?.(cleanPath);
  }

  return data as T;
}
