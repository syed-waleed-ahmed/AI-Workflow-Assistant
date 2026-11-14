import type { Scalar } from "@/lib/api/types";

const LOCALE = "en-US";

const integerFormat = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 });
const fullFormat = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 4 });
const compactFormat = new Intl.NumberFormat(LOCALE, {
  notation: "compact",
  maximumFractionDigits: 1,
});
const dateFormat = new Intl.DateTimeFormat(LOCALE, { dateStyle: "medium" });
const dateTimeFormat = new Intl.DateTimeFormat(LOCALE, { dateStyle: "medium", timeStyle: "short" });

export function formatInteger(value: number): string {
  return integerFormat.format(value);
}

/** Full-precision display (up to four decimals) for tooltips and tables. */
export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  return fullFormat.format(value);
}

const readableFormat = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 2 });
const smallFormat = new Intl.NumberFormat(LOCALE, { maximumSignificantDigits: 3 });

/**
 * Display for summary figures: at most two decimals, except for values below 1, which keep
 * three significant digits so that small rates do not round to zero. The exact value should
 * stay available (a tooltip or the evidence table).
 */
export function formatReadable(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  const magnitude = Math.abs(value);
  if (magnitude !== 0 && magnitude < 1) return smallFormat.format(value);
  return readableFormat.format(value);
}

/** Compact display for chart axes: 1.2M, 3.4K. Small magnitudes keep their decimals. */
export function formatCompact(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  const magnitude = Math.abs(value);
  if (magnitude !== 0 && magnitude < 1) return fullFormat.format(Number(value.toPrecision(2)));
  if (magnitude < 1000) return fullFormat.format(Number(value.toFixed(2)));
  return compactFormat.format(value);
}

export function formatPercent(value: number, digits = 1): string {
  return `${Number(value.toFixed(digits))}%`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 100 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}

export function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : dateFormat.format(date);
}

export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : dateTimeFormat.format(date);
}

/** "3 minutes ago" style text. `now` is injectable so it can be tested. */
export function formatRelative(iso: string, now: number = Date.now()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const seconds = Math.round((now - then) / 1000);
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} ${days === 1 ? "day" : "days"} ago`;
  return formatDate(iso);
}

export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
}

/** Display text for one table cell. Values are shown as computed; only formatting is applied. */
export function formatCell(value: Scalar | undefined): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "number") return formatNumber(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return value;
}

export function isNumeric(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Human label for a snake_case key: "missing_pct" becomes "missing pct". */
export function humanize(key: string): string {
  return key.replace(/_/g, " ");
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${formatInteger(count)} ${count === 1 ? singular : plural}`;
}
