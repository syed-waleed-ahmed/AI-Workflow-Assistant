import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { emptyResponse, errorResponse, jsonResponse, mockApi } from "@/test/utils";
import { useSlowRequest } from "./activity";
import {
  ApiError,
  apiFetch,
  apiFetchBlob,
  filenameFromContentDisposition,
  parseApiError,
  setUnauthorizedHandler,
} from "./client";

function setCsrfCookie(value: string) {
  document.cookie = `awa_csrf=${value}; path=/`;
}

describe("apiFetch", () => {
  it("calls the same-origin /api/v1 path with cookies and without a CSRF header on GET", async () => {
    setCsrfCookie("token-123");
    const api = mockApi({ "GET /api/v1/datasets": { items: [], total: 0 } });

    const result = await apiFetch<{ total: number }>("/datasets", {
      query: { limit: 20, offset: 0, skip: undefined },
    });

    expect(result).toEqual({ items: [], total: 0 });
    const call = api.calls[0]!;
    expect(api.fetch.mock.calls[0]![0]).toBe("/api/v1/datasets?limit=20&offset=0");
    expect(call.init.credentials).toBe("same-origin");
    expect(call.headers.has("X-CSRF-Token")).toBe(false);
  });

  it.each(["POST", "PATCH", "DELETE"] as const)(
    "sends the CSRF cookie value as a header on %s",
    async (method) => {
      setCsrfCookie("token-abc");
      const api = mockApi({ [`${method} /api/v1/thing`]: { ok: true } });

      await apiFetch("/thing", { method, body: method === "DELETE" ? undefined : { name: "x" } });

      const call = api.calls[0]!;
      expect(call.headers.get("X-CSRF-Token")).toBe("token-abc");
      if (method !== "DELETE") {
        expect(call.headers.get("Content-Type")).toBe("application/json");
        expect(call.body).toEqual({ name: "x" });
      }
    },
  );

  it("returns undefined for 204 responses", async () => {
    mockApi({ "POST /api/v1/auth/logout": emptyResponse(204) });
    await expect(apiFetch("/auth/logout", { method: "POST" })).resolves.toBeUndefined();
  });

  it("turns the API error body into an ApiError with code, message, request id and details", async () => {
    mockApi({
      "POST /api/v1/datasets": errorResponse(409, "sheet_selection_required", "Choose a sheet.", {
        sheets: ["Q1", "Q2"],
      }),
    });

    const error = await apiFetch("/datasets", { method: "POST" }).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 409,
      code: "sheet_selection_required",
      message: "Choose a sheet.",
      requestId: "req-test",
      details: { sheets: ["Q1", "Q2"] },
    });
  });

  it("falls back to a safe message when the proxy answers with something that is not the API error shape", async () => {
    mockApi({ "GET /api/v1/datasets": new Response("<html>Bad gateway</html>", { status: 502 }) });

    const error = (await apiFetch("/datasets").catch((cause: unknown) => cause)) as ApiError;

    expect(error.status).toBe(502);
    expect(error.code).toBe("http_502");
    expect(error.message).not.toContain("<html>");
    expect(error.isTransient).toBe(true);
  });

  it("reports a network failure as a transient ApiError instead of a raw TypeError", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    const error = (await apiFetch("/datasets").catch((cause: unknown) => cause)) as ApiError;

    expect(error).toBeInstanceOf(ApiError);
    expect(error.code).toBe("network_error");
    expect(error.isTransient).toBe(true);
  });

  it("aborts and reports a timeout when the server does not answer in time", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_input: RequestInfo | URL, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () =>
              reject(new DOMException("Aborted", "AbortError")),
            );
          }),
      ),
    );

    const pending = apiFetch("/datasets", { timeoutMs: 5000 }).catch((cause: unknown) => cause);
    await vi.advanceTimersByTimeAsync(5000);

    expect(await pending).toMatchObject({ code: "timeout", status: 0 });
  });
});

describe("401 handling", () => {
  it("notifies the unauthorized handler when the session is missing or expired", async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    mockApi({
      "GET /api/v1/auth/me": errorResponse(401, "not_authenticated", "Sign in to continue."),
    });

    await expect(apiFetch("/auth/me")).rejects.toMatchObject({
      status: 401,
      isUnauthenticated: true,
    });

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("does not treat a wrong password (also a 401) as a lost session", async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    mockApi({
      "POST /api/v1/users/me/password": errorResponse(
        401,
        "invalid_credentials",
        "Your current password is incorrect.",
      ),
    });

    await expect(
      apiFetch("/users/me/password", { method: "POST", body: {} }),
    ).rejects.toMatchObject({
      message: "Your current password is incorrect.",
      isUnauthenticated: false,
    });

    expect(handler).not.toHaveBeenCalled();
  });

  it("lets a caller opt out of the redirect", async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    mockApi({
      "POST /api/v1/auth/logout": errorResponse(401, "not_authenticated", "Sign in to continue."),
    });

    await expect(
      apiFetch("/auth/logout", { method: "POST", handleUnauthorized: false }),
    ).rejects.toBeInstanceOf(ApiError);

    expect(handler).not.toHaveBeenCalled();
  });
});

describe("downloads", () => {
  it("returns the blob together with the filename from Content-Disposition", async () => {
    mockApi({
      "GET /api/v1/reports/r1/export": new Response("# Report", {
        status: 200,
        headers: {
          "Content-Disposition": "attachment; filename*=UTF-8''Regional%20Sales%20Report.md",
        },
      }),
    });

    const { blob, filename } = await apiFetchBlob("/reports/r1/export", {
      query: { format: "md" },
    });

    expect(filename).toBe("Regional Sales Report.md");
    expect(blob.size).toBe(8);
  });

  it("parses both header forms and tolerates a missing header", () => {
    expect(
      filenameFromContentDisposition("attachment; filename*=UTF-8''r%C3%A9sum%C3%A9.pdf"),
    ).toBe("résumé.pdf");
    expect(filenameFromContentDisposition('attachment; filename="report.xlsx"')).toBe(
      "report.xlsx",
    );
    expect(filenameFromContentDisposition(null)).toBeNull();
  });
});

describe("parseApiError", () => {
  it("keeps the validation details the API sends with a 422", () => {
    const error = parseApiError(
      422,
      JSON.stringify({
        error: {
          code: "validation_error",
          message: "The request is not valid.",
          request_id: "abc",
          details: [{ field: "email", message: "Enter a valid email address." }],
        },
      }),
    );
    expect(error.code).toBe("validation_error");
    expect(error.details).toEqual([{ field: "email", message: "Enter a valid email address." }]);
  });

  it("drops the validator's 'Value error, ' prefix the API currently leaves on 422 messages", () => {
    // Body observed from the real API for POST /analyses with a one-character question.
    const error = parseApiError(
      422,
      JSON.stringify({
        error: {
          code: "validation_error",
          message: "Value error, Ask a question of at least 3 characters.",
          request_id: "3a57bed19d4148aab928cce97891fd19",
          details: [
            { field: "question", message: "Value error, Ask a question of at least 3 characters." },
          ],
        },
      }),
    );
    expect(error.message).toBe("Ask a question of at least 3 characters.");
    expect(error.details).toEqual([
      { field: "question", message: "Ask a question of at least 3 characters." },
    ]);
  });

  it("leaves messages of other errors untouched", () => {
    const error = parseApiError(
      409,
      JSON.stringify({
        error: { code: "conflict", message: "Value error, kept as sent.", request_id: "x" },
      }),
    );
    expect(error.message).toBe("Value error, kept as sent.");
  });
});

describe("slow request tracking", () => {
  it("flags a request that has been pending for more than four seconds, and clears when it settles", async () => {
    vi.useFakeTimers();
    let respond: (response: Response) => void = () => undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>((resolve) => (respond = resolve))),
    );
    const { result } = renderHook(() => useSlowRequest());

    const pending = apiFetch("/users/me/usage");
    await act(() => vi.advanceTimersByTimeAsync(3900));
    expect(result.current).toBe(false);

    await act(() => vi.advanceTimersByTimeAsync(200));
    expect(result.current).toBe(true);

    await act(async () => {
      respond(jsonResponse({ ok: true }));
      await pending;
    });
    expect(result.current).toBe(false);
  });
});
