import { beforeEach, describe, expect, it, vi } from "vitest";
import { dataset } from "@/test/fixtures";
import { FakeXhr, mockApi } from "@/test/utils";
import { ApiError } from "./client";
import { sheetChoices, uploadDataset, validateUploadFile } from "./upload";

const csv = () => new File(["a,b\n1,2\n"], "sales.csv", { type: "text/csv" });

/** Lets the code under test run up to the point where it has sent the request. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  FakeXhr.install();
});

describe("validateUploadFile", () => {
  it("accepts the supported spreadsheet formats regardless of case", () => {
    for (const name of ["a.csv", "a.TSV", "a.xlsx", "a.xls"]) {
      expect(validateUploadFile(new File(["x"], name), 1000)).toBeNull();
    }
  });

  it("rejects other file types, empty files and files over the account limit", () => {
    expect(validateUploadFile(new File(["x"], "notes.pdf"), 1000)).toMatch(/not supported/);
    expect(validateUploadFile(new File([], "empty.csv"), 1000)).toMatch(/empty/);
    const big = new File([new Uint8Array(3 * 1024 * 1024)], "big.csv");
    expect(validateUploadFile(big, 2 * 1024 * 1024)).toBe(
      "This file is 3.0 MB. The limit is 2.0 MB.",
    );
  });
});

describe("uploadDataset through the same-origin proxy", () => {
  it("posts multipart data with cookies and the CSRF header, and reports real progress", async () => {
    document.cookie = "awa_csrf=csrf-1; path=/";
    const onProgress = vi.fn();
    const file = csv();

    const promise = uploadDataset({ file, onProgress });
    await flush();
    const xhr = FakeXhr.last;

    expect(xhr.method).toBe("POST");
    expect(xhr.url).toBe("/api/v1/datasets");
    expect(xhr.withCredentials).toBe(true);
    expect(xhr.requestHeaders["X-CSRF-Token"]).toBe("csrf-1");
    expect(xhr.requestHeaders["Authorization"]).toBeUndefined();
    expect(xhr.body?.get("file")).toBe(file);
    expect(xhr.body?.has("sheet")).toBe(false);

    xhr.progress(25, 100);
    xhr.progress(100, 100);
    expect(onProgress.mock.calls.map((call) => call[0])).toEqual([0.25, 1]);

    xhr.respond(201, dataset);
    await expect(promise).resolves.toMatchObject({ id: dataset.id, row_count: 2400 });
  });

  it("sends the chosen sheet and name as form fields", async () => {
    const promise = uploadDataset({ file: csv(), sheet: "Q2", name: "Quarter two" });
    await flush();

    expect(FakeXhr.last.body?.get("sheet")).toBe("Q2");
    expect(FakeXhr.last.body?.get("name")).toBe("Quarter two");
    FakeXhr.last.respond(201, dataset);
    await promise;
  });

  it("rejects with the API error, including the sheet list on a 409", async () => {
    const promise = uploadDataset({ file: csv() });
    await flush();
    FakeXhr.last.respond(409, {
      error: {
        code: "sheet_selection_required",
        message: "This workbook has several sheets. Choose the one to import.",
        request_id: "r1",
        details: { sheets: ["Summary", "Raw data"] },
      },
    });

    const error = await promise.catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(ApiError);
    expect(sheetChoices(error)).toEqual(["Summary", "Raw data"]);
  });

  it("reports a dropped connection as an ApiError", async () => {
    const promise = uploadDataset({ file: csv() });
    await flush();
    FakeXhr.last.fail();

    await expect(promise).rejects.toMatchObject({ code: "network_error", status: 0 });
  });

  it("aborts the request when the caller cancels", async () => {
    const controller = new AbortController();
    const promise = uploadDataset({ file: csv(), signal: controller.signal });
    await flush();

    controller.abort();

    expect(FakeXhr.last.aborted).toBe(true);
    await expect(promise).rejects.toMatchObject({ code: "aborted" });
  });
});

describe("uploadDataset straight to the API host", () => {
  it("fetches an upload ticket first, then posts with a Bearer token and no cookies", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_DIRECT_URL", "https://api.example.com/");
    document.cookie = "awa_csrf=csrf-2; path=/";
    const api = mockApi({
      "POST /api/v1/datasets/upload-ticket": { ticket: "ticket-xyz", expires_in: 120 },
    });

    const promise = uploadDataset({ file: csv() });
    await flush();

    // The ticket request is an ordinary same-origin, CSRF-protected call.
    expect(api.calls[0]?.headers.get("X-CSRF-Token")).toBe("csrf-2");
    const xhr = FakeXhr.last;
    expect(xhr.url).toBe("https://api.example.com/api/v1/datasets");
    expect(xhr.requestHeaders["Authorization"]).toBe("Bearer ticket-xyz");
    expect(xhr.withCredentials).toBe(false);
    expect(xhr.requestHeaders["X-CSRF-Token"]).toBeUndefined();

    xhr.respond(201, dataset);
    await expect(promise).resolves.toMatchObject({ id: dataset.id });
  });
});

describe("sheetChoices", () => {
  it("is null for unrelated errors", () => {
    expect(sheetChoices(new ApiError(422, "invalid_file", "Bad file"))).toBeNull();
    expect(sheetChoices(new Error("boom"))).toBeNull();
  });
});
