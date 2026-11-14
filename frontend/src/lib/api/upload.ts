import { trackRequest } from "./activity";
import { API_PREFIX, ApiError, CSRF_HEADER, getCsrfToken, parseApiError } from "./client";
import { datasetsApi } from "./endpoints";
import type { Dataset } from "./types";

export const ACCEPTED_EXTENSIONS = [".csv", ".tsv", ".xlsx", ".xls"] as const;
export const ACCEPT_ATTRIBUTE = ACCEPTED_EXTENSIONS.join(",");

export interface UploadOptions {
  file: File;
  /** Sheet to import from a multi-sheet workbook. */
  sheet?: string;
  name?: string;
  /** Called with the fraction of the request body sent so far (0 to 1). */
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

function megabytes(bytes: number): string {
  const value = bytes / (1024 * 1024);
  return value >= 10 ? value.toFixed(0) : value.toFixed(1);
}

/** Mirrors the API rules on the client, so obvious mistakes fail before any bytes are sent. */
export function validateUploadFile(file: File, maxBytes: number | undefined): string | null {
  const name = file.name.toLowerCase();
  if (!ACCEPTED_EXTENSIONS.some((extension) => name.endsWith(extension))) {
    return "This file type is not supported. Upload a CSV, TSV, XLSX or XLS file.";
  }
  if (file.size === 0) return "This file is empty.";
  if (maxBytes !== undefined && file.size > maxBytes) {
    return `This file is ${megabytes(file.size)} MB. The limit is ${megabytes(maxBytes)} MB.`;
  }
  return null;
}

/** The sheets a 409 `sheet_selection_required` error asks the user to choose from. */
export function sheetChoices(error: unknown): string[] | null {
  if (!(error instanceof ApiError) || error.code !== "sheet_selection_required") return null;
  const details = error.details;
  if (!details || typeof details !== "object" || !("sheets" in details)) return [];
  const sheets = (details as { sheets: unknown }).sheets;
  return Array.isArray(sheets)
    ? sheets.filter((sheet): sheet is string => typeof sheet === "string")
    : [];
}

export function directUploadBase(): string | null {
  const value = process.env.NEXT_PUBLIC_API_DIRECT_URL;
  return value ? value.replace(/\/+$/, "") : null;
}

/**
 * Uploads a dataset with XMLHttpRequest so real upload progress can be reported.
 *
 * Local development posts through the same-origin proxy with the session cookie and CSRF
 * header. When `NEXT_PUBLIC_API_DIRECT_URL` is set, the file goes straight to the API host
 * instead, authorised by a short-lived ticket and without cookies, because the frontend
 * host limits the size of proxied request bodies.
 */
export async function uploadDataset(options: UploadOptions): Promise<Dataset> {
  const direct = directUploadBase();
  const form = new FormData();
  form.append("file", options.file);
  if (options.sheet) form.append("sheet", options.sheet);
  if (options.name) form.append("name", options.name);

  if (direct) {
    const { ticket } = await datasetsApi.uploadTicket();
    return sendForm(`${direct}${API_PREFIX}/datasets`, form, options, {
      headers: { Authorization: `Bearer ${ticket}` },
      withCredentials: false,
    });
  }

  const headers: Record<string, string> = {};
  const csrf = getCsrfToken();
  if (csrf) headers[CSRF_HEADER] = csrf;
  return sendForm(`${API_PREFIX}/datasets`, form, options, { headers, withCredentials: true });
}

function sendForm(
  url: string,
  form: FormData,
  options: UploadOptions,
  transport: { headers: Record<string, string>; withCredentials: boolean },
): Promise<Dataset> {
  return new Promise<Dataset>((resolve, reject) => {
    const cancelled = () => new ApiError(0, "aborted", "The upload was cancelled.");
    if (options.signal?.aborted) {
      reject(cancelled());
      return;
    }

    const xhr = new XMLHttpRequest();
    const done = trackRequest();
    const abort = () => xhr.abort();
    const settle = () => {
      done();
      options.signal?.removeEventListener("abort", abort);
    };

    xhr.open("POST", url);
    xhr.withCredentials = transport.withCredentials;
    xhr.setRequestHeader("Accept", "application/json");
    for (const [key, value] of Object.entries(transport.headers)) xhr.setRequestHeader(key, value);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0)
        options.onProgress?.(event.loaded / event.total);
    };
    xhr.onload = () => {
      settle();
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText) as Dataset);
        } catch {
          reject(
            new ApiError(xhr.status, "invalid_response", "The server sent an unexpected response."),
          );
        }
        return;
      }
      reject(parseApiError(xhr.status, xhr.responseText));
    };
    xhr.onerror = () => {
      settle();
      reject(
        new ApiError(0, "network_error", "The upload failed. Check your connection and try again."),
      );
    };
    xhr.ontimeout = () => {
      settle();
      reject(new ApiError(0, "timeout", "The upload took too long. Please try again."));
    };
    xhr.onabort = () => {
      settle();
      reject(cancelled());
    };

    options.signal?.addEventListener("abort", abort, { once: true });
    xhr.send(form);
  });
}
