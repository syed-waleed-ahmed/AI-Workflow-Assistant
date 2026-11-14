import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, type RenderResult } from "@testing-library/react";
import type { ReactElement } from "react";
import { vi } from "vitest";

/** A query client for tests: no retries, so a mocked failure surfaces immediately. */
export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false },
    },
  });
}

export function renderWithClient(
  ui: ReactElement,
  client: QueryClient = createTestQueryClient(),
): RenderResult & { client: QueryClient } {
  const result = render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
  return { ...result, client };
}

export function jsonResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

export function errorResponse(
  status: number,
  code: string,
  message: string,
  details?: unknown,
): Response {
  return jsonResponse({ error: { code, message, request_id: "req-test", details } }, status);
}

export function emptyResponse(status = 204): Response {
  return new Response(null, { status });
}

export interface RecordedCall {
  method: string;
  path: string;
  query: URLSearchParams;
  headers: Headers;
  body: unknown;
  init: RequestInit;
}

type Responder = (call: RecordedCall) => Response | Promise<Response>;
/** A route answers with a fixed JSON body, a prepared Response, or a function of the request. */
export type Route = Responder | Response | object;

/**
 * Replaces `fetch` with a router keyed by "METHOD /path". A request with no matching route
 * fails the test loudly instead of hanging.
 */
export function mockApi(routes: Record<string, Route>): {
  calls: RecordedCall[];
  fetch: ReturnType<typeof vi.fn>;
} {
  const calls: RecordedCall[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input), "http://localhost");
    const method = (init.method ?? "GET").toUpperCase();
    let body: unknown = init.body;
    if (typeof init.body === "string") {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    const call: RecordedCall = {
      method,
      path: url.pathname,
      query: url.searchParams,
      headers: new Headers(init.headers),
      body,
      init,
    };
    calls.push(call);
    const route = routes[`${method} ${url.pathname}`];
    if (route === undefined) {
      throw new Error(`Unexpected request in test: ${method} ${url.pathname}${url.search}`);
    }
    if (typeof route === "function") return (route as Responder)(call);
    if (route instanceof Response) return route.clone();
    return jsonResponse(route);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetch: fetchMock };
}

/**
 * A scriptable XMLHttpRequest. Tests drive each instance by hand: report upload progress,
 * then respond, so the real upload code path is exercised without a network.
 */
export class FakeXhr {
  static instances: FakeXhr[] = [];

  method = "";
  url = "";
  withCredentials = false;
  status = 0;
  responseText = "";
  requestHeaders: Record<string, string> = {};
  body: FormData | null = null;
  aborted = false;
  upload: { onprogress: ((event: ProgressEvent) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onabort: (() => void) | null = null;

  constructor() {
    FakeXhr.instances.push(this);
  }

  open(method: string, url: string): void {
    this.method = method;
    this.url = url;
  }

  setRequestHeader(name: string, value: string): void {
    this.requestHeaders[name] = value;
  }

  send(body: FormData): void {
    this.body = body;
  }

  abort(): void {
    this.aborted = true;
    this.onabort?.();
  }

  /** Simulates the browser reporting that `loaded` of `total` bytes have been sent. */
  progress(loaded: number, total: number): void {
    this.upload.onprogress?.({ lengthComputable: true, loaded, total } as ProgressEvent);
  }

  respond(status: number, body: unknown): void {
    this.status = status;
    this.responseText = typeof body === "string" ? body : JSON.stringify(body);
    this.onload?.();
  }

  fail(): void {
    this.onerror?.();
  }

  static install(): void {
    FakeXhr.instances = [];
    vi.stubGlobal("XMLHttpRequest", FakeXhr);
  }

  static get last(): FakeXhr {
    const instance = FakeXhr.instances[FakeXhr.instances.length - 1];
    if (!instance) throw new Error("No XMLHttpRequest was created");
    return instance;
  }
}
