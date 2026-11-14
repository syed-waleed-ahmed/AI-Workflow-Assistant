import type { Chart, Scalar } from "@/lib/api/types";
import { formatNumber, isNumeric } from "@/lib/format";

export type ChartPoint = Record<string, Scalar>;

/** The fixed categorical order. Series take colours by position; they are never re-ranked. */
export const SERIES_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--chart-6)",
  "var(--chart-7)",
  "var(--chart-8)",
] as const;

export function seriesColor(index: number): string {
  return SERIES_COLORS[index % SERIES_COLORS.length] ?? SERIES_COLORS[0];
}

/** Largest absolute value of one series, or null when it has no numeric points. */
function seriesMagnitude(chart: Chart, key: string): number | null {
  let max: number | null = null;
  for (const point of chart.data ?? []) {
    const value = point[key];
    if (isNumeric(value)) max = Math.max(max ?? 0, Math.abs(value));
  }
  return max;
}

/**
 * Whether the series of a chart should be drawn as separate panels instead of sharing one axis.
 *
 * A tool can return measures of very different scale together (total revenue in the millions
 * next to an average price in the hundreds). On one axis the smaller measure would be
 * flattened to nothing, and a second y-axis invites false comparisons, so each measure gets
 * its own panel. The values themselves are untouched.
 */
export function shouldFacet(chart: Chart): boolean {
  if (chart.type !== "bar" && chart.type !== "line") return false;
  const series = chart.series ?? [];
  if (series.length < 2) return false;
  const magnitudes = series
    .map((item) => seriesMagnitude(chart, item.key))
    .filter((value): value is number => value !== null && value > 0);
  if (magnitudes.length < 2) return false;
  return Math.max(...magnitudes) / Math.min(...magnitudes) > 20;
}

export interface HeatmapModel {
  xs: string[];
  ys: string[];
  /** Cell value by `${y}\u0000${x}`. */
  cells: Map<string, number | null>;
}

export function heatmapKey(x: string, y: string): string {
  return `${y}\u0000${x}`;
}

/** Arranges `[{x, y, value}]` points into a grid, keeping the order the API sent. */
export function buildHeatmap(chart: Chart): HeatmapModel {
  const xs: string[] = [];
  const ys: string[] = [];
  const cells = new Map<string, number | null>();
  for (const point of chart.data ?? []) {
    const x = String(point["x"] ?? "");
    const y = String(point["y"] ?? "");
    if (!xs.includes(x)) xs.push(x);
    if (!ys.includes(y)) ys.push(y);
    const value = point["value"];
    cells.set(heatmapKey(x, y), isNumeric(value) ? value : null);
  }
  return { xs, ys, cells };
}

/** Background for a correlation cell: neutral at 0, blue towards +1, red towards -1. */
export function heatColor(value: number | null): string {
  if (value === null) return "transparent";
  const strength = Math.min(1, Math.abs(value));
  // Capped so the cell text keeps AA contrast in both themes.
  const percent = Math.round(strength * 70);
  const pole = value >= 0 ? "var(--heat-positive)" : "var(--heat-negative)";
  return `color-mix(in oklab, ${pole} ${percent}%, var(--heat-neutral))`;
}

const TYPE_NAMES: Record<Chart["type"], string> = {
  bar: "Bar chart",
  line: "Line chart",
  pie: "Pie chart",
  histogram: "Histogram",
  scatter: "Scatter plot",
  heatmap: "Heatmap",
};

function numericRange(chart: Chart, key: string): string | null {
  let min: number | null = null;
  let max: number | null = null;
  for (const point of chart.data ?? []) {
    const value = point[key];
    if (!isNumeric(value)) continue;
    min = min === null ? value : Math.min(min, value);
    max = max === null ? value : Math.max(max, value);
  }
  if (min === null || max === null) return null;
  return min === max ? formatNumber(min) : `${formatNumber(min)} to ${formatNumber(max)}`;
}

/** A text summary of a chart for assistive technology, built only from the chart spec. */
export function describeChart(chart: Chart): string {
  const data = chart.data ?? [];
  const series = chart.series ?? [];
  const parts: string[] = [`${TYPE_NAMES[chart.type]}: ${chart.title}.`];

  if (data.length === 0) {
    parts.push("No data points.");
    return parts.join(" ");
  }

  if (chart.type === "heatmap") {
    const { xs, ys } = buildHeatmap(chart);
    parts.push(`${ys.length} by ${xs.length} grid of values between -1 and 1.`);
  } else if (chart.type === "scatter") {
    parts.push(`${data.length} points.`);
    const xRange = numericRange(chart, chart.x_key);
    const yKey = chart.y_label ?? "";
    const yRange = numericRange(chart, yKey);
    if (xRange) parts.push(`${chart.x_label || chart.x_key} ranges from ${xRange}.`);
    if (yRange) parts.push(`${yKey} ranges from ${yRange}.`);
  } else {
    const first = data[0]?.[chart.x_key];
    const last = data[data.length - 1]?.[chart.x_key];
    const axis = chart.x_label || chart.x_key;
    parts.push(
      data.length === 1
        ? `1 ${axis} value: ${String(first)}.`
        : `${data.length} ${axis} values from ${String(first)} to ${String(last)}.`,
    );
    for (const item of series.slice(0, 6)) {
      const range = numericRange(chart, item.key);
      if (range) parts.push(`${item.label} ranges from ${range}.`);
    }
    if (series.length > 6) parts.push(`${series.length - 6} more series.`);
  }
  parts.push("The underlying table is in the Methodology section.");
  return parts.join(" ");
}

export function truncateLabel(value: unknown, max = 14): string {
  const text = String(value ?? "");
  return text.length > max ? `${text.slice(0, Math.max(1, max - 1)).trimEnd()}…` : text;
}
