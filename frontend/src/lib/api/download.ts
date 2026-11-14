import { apiFetchBlob } from "./client";
import type { ExportFormat } from "./types";

/** Hands a blob to the browser as a file download. */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Give the browser a moment to start the download before the URL is released.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Downloads a report export. It goes through `fetch` rather than a plain link so the request
 * uses the authenticated same-origin proxy and failures come back as readable `ApiError`s.
 */
export async function downloadReportExport(
  reportId: string,
  format: ExportFormat,
  evidenceId?: string,
): Promise<string> {
  const { blob, filename } = await apiFetchBlob(`/reports/${encodeURIComponent(reportId)}/export`, {
    query: { format, evidence_id: evidenceId },
  });
  const name = filename ?? `report${evidenceId ? `-${evidenceId}` : ""}.${format}`;
  saveBlob(blob, name);
  return name;
}
