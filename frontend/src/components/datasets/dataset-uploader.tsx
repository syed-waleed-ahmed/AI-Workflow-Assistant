"use client";

import { FileSpreadsheet, FlaskConical, Upload } from "lucide-react";
import { useId, useRef, useState, type DragEvent } from "react";
import { InlineError } from "@/components/common/states";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ApiError, errorMessage } from "@/lib/api/client";
import type { Dataset } from "@/lib/api/types";
import { ACCEPT_ATTRIBUTE, sheetChoices, validateUploadFile } from "@/lib/api/upload";
import { formatBytes, formatInteger } from "@/lib/format";
import { useUploadDataset, useUsage } from "@/lib/query/hooks";
import { cn } from "@/lib/utils";

export const SAMPLE_DATASET_URL = "/samples/sample_sales.csv";
const SAMPLE_DATASET_NAME = "sample_sales.csv";

type Phase =
  | { kind: "idle" }
  | { kind: "uploading"; file: File; fraction: number }
  | { kind: "sheets"; file: File; sheets: string[] };

export interface DatasetUploaderProps {
  onUploaded: (dataset: Dataset) => void;
  /** Reports whether an upload is in flight, so a surrounding dialog can block closing. */
  onBusyChange?: (busy: boolean) => void;
  className?: string;
}

/**
 * Chooses a file (picker, drag-and-drop or the bundled sample), uploads it with real progress,
 * and handles the two follow-up states the API can ask for: picking a sheet from a multi-sheet
 * workbook, and showing why a file was rejected.
 */
export function DatasetUploader({ onUploaded, onBusyChange, className }: DatasetUploaderProps) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const usage = useUsage();
  const upload = useUploadDataset();
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [sheet, setSheet] = useState<string>("");
  const [loadingSample, setLoadingSample] = useState(false);

  const maxBytes = usage.data?.max_upload_bytes;

  const start = async (file: File, selectedSheet?: string) => {
    const problem = validateUploadFile(file, maxBytes);
    if (problem) {
      setError(problem);
      setPhase({ kind: "idle" });
      return;
    }
    setError(null);
    setPhase({ kind: "uploading", file, fraction: 0 });
    onBusyChange?.(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const dataset = await upload.mutateAsync({
        file,
        sheet: selectedSheet,
        signal: controller.signal,
        onProgress: (fraction) => setPhase({ kind: "uploading", file, fraction }),
      });
      setPhase({ kind: "idle" });
      onUploaded(dataset);
    } catch (cause) {
      const sheets = sheetChoices(cause);
      if (sheets && sheets.length > 0) {
        setSheet(sheets[0] ?? "");
        setPhase({ kind: "sheets", file, sheets });
      } else {
        setPhase({ kind: "idle" });
        if (!(cause instanceof ApiError && cause.code === "aborted")) {
          setError(errorMessage(cause, "The upload failed. Please try again."));
        }
      }
    } finally {
      abortRef.current = null;
      onBusyChange?.(false);
    }
  };

  const uploadSample = async () => {
    setError(null);
    setLoadingSample(true);
    try {
      const response = await fetch(SAMPLE_DATASET_URL);
      if (!response.ok) throw new Error("sample unavailable");
      // Raw bytes rather than a Blob: every File implementation accepts an ArrayBuffer part,
      // whereas a Blob from one implementation is not always recognised by another.
      const bytes = await response.arrayBuffer();
      setLoadingSample(false);
      await start(new File([bytes], SAMPLE_DATASET_NAME, { type: "text/csv" }));
    } catch {
      setLoadingSample(false);
      setError("The sample dataset could not be loaded. Please try again.");
    }
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) void start(file);
  };

  if (phase.kind === "uploading") {
    const sent = phase.fraction >= 1;
    const percent = Math.round(phase.fraction * 100);
    return (
      <div className={cn("flex flex-col gap-4 rounded-lg border border-border p-5", className)}>
        <div className="flex items-start gap-3">
          <FileSpreadsheet
            className="mt-0.5 size-5 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{phase.file.name}</p>
            <p className="tabular text-xs text-muted-foreground">{formatBytes(phase.file.size)}</p>
          </div>
        </div>
        <div className="space-y-1.5">
          <Progress value={sent ? null : percent} aria-label="Upload progress" />
          <p className="tabular text-xs text-muted-foreground" role="status" aria-live="polite">
            {sent
              ? "Upload complete. Validating and profiling the data…"
              : `Uploading… ${percent}%`}
          </p>
        </div>
        <div>
          <Button variant="outline" size="sm" onClick={() => abortRef.current?.abort()}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  if (phase.kind === "sheets") {
    return (
      <form
        className={cn("flex flex-col gap-4 rounded-lg border border-border p-5", className)}
        onSubmit={(event) => {
          event.preventDefault();
          if (sheet) void start(phase.file, sheet);
        }}
      >
        <fieldset className="space-y-3">
          <legend className="text-sm font-medium">Choose a sheet to import</legend>
          <p className="text-sm leading-6 text-muted-foreground">
            <span className="font-medium break-all text-foreground">{phase.file.name}</span> has{" "}
            {phase.sheets.length} sheets. Each dataset holds one sheet.
          </p>
          <div className="max-h-56 space-y-1 overflow-y-auto">
            {phase.sheets.map((name) => (
              <label
                key={name}
                className="flex cursor-pointer items-center gap-2.5 rounded-md border border-border px-3 py-2 text-sm has-checked:border-ring has-checked:bg-accent-soft"
              >
                <input
                  type="radio"
                  name={`${inputId}-sheet`}
                  value={name}
                  checked={sheet === name}
                  onChange={() => setSheet(name)}
                  className="accent-(--primary)"
                />
                <span className="min-w-0 wrap-break-word">{name}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" size="sm" disabled={!sheet}>
            Import sheet
          </Button>
          <Button variant="outline" size="sm" onClick={() => setPhase({ kind: "idle" })}>
            Choose another file
          </Button>
        </div>
      </form>
    );
  }

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        data-dragging={dragging}
        className={cn(
          "flex flex-col items-center gap-3 rounded-lg border border-dashed border-input px-6 py-8 text-center transition-colors",
          dragging && "border-ring bg-accent-soft",
        )}
      >
        <span className="flex size-10 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <Upload className="size-5" aria-hidden="true" />
        </span>
        <div className="space-y-1">
          <p className="text-sm font-medium">Drag a file here, or choose one</p>
          <p className="text-xs leading-5 text-muted-foreground">
            CSV, TSV, XLSX or XLS
            {maxBytes !== undefined ? ` · up to ${formatBytes(maxBytes)}` : ""}
            {usage.data
              ? ` · up to ${formatInteger(usage.data.max_rows)} rows and ${formatInteger(usage.data.max_columns)} columns`
              : ""}
          </p>
        </div>
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          accept={ACCEPT_ATTRIBUTE}
          className="sr-only"
          aria-label="Choose a dataset file"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void start(file);
          }}
        />
        <div className="flex flex-wrap justify-center gap-2">
          <Button size="sm" onClick={() => inputRef.current?.click()}>
            Choose file
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void uploadSample()}
            loading={loadingSample}
          >
            {loadingSample ? null : <FlaskConical aria-hidden="true" />}
            Try the sample dataset
          </Button>
        </div>
      </div>
      <InlineError>{error}</InlineError>
      <p className="text-xs leading-5 text-muted-foreground">
        Files are validated before they are stored. Spreadsheet formulas and macros are never
        executed. The sample is a 2,400-row sales dataset bundled with this app.
      </p>
    </div>
  );
}
