import { trackRequest } from "./activity";

export const API_PREFIX = "/api/v1";
export const CSRF_COOKIE = "awa_csrf";
export const CSRF_HEADER = "X-CSRF-Token";
const DEFAULT_TIMEOUT_MS = 90_000;
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** The error body every non-2xx API response carries. `message` is always safe to show. */
export interface ApiErrorBody {
  error: { code: string; message: string; request_id?: string; details?: unknown };
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string | null;
  readonly details: unknown;

  constructor(
    status: number,
    code: string,
    message: string,
    options: { requestId?: string | null; details?: unknown } = {},
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.requestId = options.requestId ?? null;
    this.details = options.details;
  }

  /** The session is missing or expired (as opposed to a wrong password, which is also a 401). */
  get isUnauthenticated(): boolean {
    return this.status === 401 && this.code !== "invalid_credentials";
  }

  /** Worth retrying: the request never reached the API or the API was unavailable. */
  get isTransient(): boolean {
    return this.status === 0 || this.status === 502 || this.status === 503 || this.status === 504;
  }
}

/** Message for any thrown value, falling back to a generic sentence for unknown errors. */
export function errorMessage(
  error: unknown,
  fallback = "Something went wrong. Please try again.",
): string {
  if (error instanceof ApiError) return error.message;
  return fallback;
}

export function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const prefix = `${name}=`;
  for (const part of document.cookie.split(";")) {
    const trimmed = part.trim();
    if (trimmed.startsWith(prefix)) {
      try {
        return decodeURIComponent(trimmed.slice(prefix.length));
      } catch {
        return trimmed.slice(prefix.length);
      }
    }
  }
  return null;
}

export function getCsrfToken(): string | null {
  return readCookie(CSRF_COOKIE);
}

type UnauthorizedHandler = (error: ApiError) => void;
let unauthorizedHandler: UnauthorizedHandler | null = null;

/** Registers what happens when the API reports that the session is gone. */
export function setUnauthorizedHandler(handler: UnauthorizedHandler | null): void {
  unauthorizedHandler = handler;
}

function fallbackMessage(status: number): string {
  if (status === 502 || status === 503 || status === 504) {
    return "The server is not responding right now. It may be starting up — please try again in a moment.";
  }
  if (status === 413) return "The request is too large.";
  if (status === 429) return "Too many requests. Please wait a moment and try again.";
  if (status >= 500) return "Something went wrong on our side. Please try again.";
  return "The request could not be completed.";
}

/**
 * The API's validation messages currently arrive with the validator's own prefix
 * ("Value error, Enter your name."). Only that known prefix is removed for display.
 */
function cleanValidationText(text: string): string {
  return text.replace(/^(Value error|Assertion failed), /, "");
}

function cleanValidationDetails(details: unknown): unknown {
  if (!Array.isArray(details)) return details;
  return details.map((item: unknown) =>
    item && typeof item === "object" && typeof (item as { message?: unknown }).message === "string"
      ? { ...item, message: cleanValidationText((item as { message: string }).message) }
      : item,
  );
}

/** Builds an `ApiError` from a status code and a raw response body (JSON text or anything else). */
export function parseApiError(status: number, bodyText: string): ApiError {
  try {
    const parsed: unknown = JSON.parse(bodyText);
    if (parsed && typeof parsed === "object" && "error" in parsed) {
      const body = (parsed as ApiErrorBody).error;
      if (body && typeof body.code === "string" && typeof body.message === "string") {
        const validation = body.code === "validation_error";
        return new ApiError(
          status,
          body.code,
          validation ? cleanValidationText(body.message) : body.message,
          {
            requestId: typeof body.request_id === "string" ? body.request_id : null,
            details: validation ? cleanValidationDetails(body.details) : body.details,
          },
        );
      }
    }
  } catch {
    // Not JSON: the proxy or the host answered instead of the API.
  }
  return new ApiError(status, `http_${status}`, fallbackMessage(status));
}

export type QueryParams = Record<string, string | number | boolean | null | undefined>;

export function buildUrl(path: string, query?: QueryParams): string {
  const url = `${API_PREFIX}${path}`;
  if (!query) return url;
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null) search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `${url}?${text}` : url;
}

export interface ApiFetchOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  /** Sent as JSON. */
  body?: unknown;
  query?: QueryParams;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Set to false for calls that must not trigger the global signed-out redirect. */
  handleUnauthorized?: boolean;
}

async function send(path: string, options: ApiFetchOptions): Promise<Response> {
  const method = options.method ?? "GET";
  const headers: Record<string, string> = { Accept: "application/json" };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (!SAFE_METHODS.has(method)) {
    const token = getCsrfToken();
    if (token) headers[CSRF_HEADER] = token;
  }

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  if (options.signal) {
    if (options.signal.aborted) controller.abort();
    else options.signal.addEventListener("abort", onAbort, { once: true });
  }
  const done = trackRequest();

  let response: Response;
  try {
    response = await fetch(buildUrl(path, options.query), {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      credentials: "same-origin",
      cache: "no-store",
      signal: controller.signal,
    });
  } catch (cause) {
    if (options.signal?.aborted && !timedOut) throw cause;
    if (timedOut) {
      throw new ApiError(0, "timeout", "The server took too long to respond. Please try again.");
    }
    throw new ApiError(
      0,
      "network_error",
      "Could not reach the server. Check your connection and try again.",
    );
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onAbort);
    done();
  }

  if (!response.ok) {
    const error = parseApiError(response.status, await response.text().catch(() => ""));
    if (error.isUnauthenticated && options.handleUnauthorized !== false)
      unauthorizedHandler?.(error);
    throw error;
  }
  return response;
}

/**
 * The one way the app talks to the API: same-origin, cookie-authenticated, CSRF header on
 * every state-changing request, and every failure turned into an `ApiError`.
 */
export async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const response = await send(path, options);
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ApiError(
      response.status,
      "invalid_response",
      "The server sent an unexpected response.",
    );
  }
}

/** Fetches a binary response (an export) together with the filename the API suggests. */
export async function apiFetchBlob(
  path: string,
  options: ApiFetchOptions = {},
): Promise<{ blob: Blob; filename: string | null }> {
  const response = await send(path, options);
  const blob = await response.blob();
  return {
    blob,
    filename: filenameFromContentDisposition(response.headers.get("Content-Disposition")),
  };
}

/** Reads `filename*=UTF-8''…` (preferred) or `filename="…"` from a Content-Disposition header. */
export function filenameFromContentDisposition(header: string | null): string | null {
  if (!header) return null;
  const extended = /filename\*\s*=\s*([^']*)'[^']*'([^;]+)/i.exec(header);
  if (extended?.[2]) {
    try {
      return decodeURIComponent(extended[2].trim());
    } catch {
      return extended[2].trim();
    }
  }
  const plain = /filename\s*=\s*("([^"]*)"|[^;]+)/i.exec(header);
  const value = plain?.[2] ?? plain?.[1];
  return value ? value.trim() : null;
}
