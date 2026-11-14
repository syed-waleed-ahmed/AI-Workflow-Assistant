"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Chart, ChartSeries } from "@/lib/api/types";
import { formatCompact, formatNumber, isNumeric } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  buildHeatmap,
  describeChart,
  heatColor,
  heatmapKey,
  seriesColor,
  shouldFacet,
  truncateLabel,
  type ChartPoint,
} from "./chart-model";

const FALLBACK_WIDTH = 640;
const AXIS_TICK = { fill: "var(--chart-axis)", fontSize: 12 } as const;
const MARGIN = { top: 8, right: 12, bottom: 4, left: 4 } as const;

/** Tooltips take at most about 60% of a chart, so they always fit beside the pointer. */
function tooltipWidth(chartWidth: number): number {
  return Math.round(Math.min(256, Math.max(150, chartWidth * 0.6)));
}

/**
 * Measures the available width so charts can be given explicit pixel sizes. Where
 * ResizeObserver does not exist (tests) a fixed width is used; on the server nothing is
 * drawn until the browser has measured.
 */
function useChartWidth(): [React.RefObject<HTMLDivElement | null>, number | null] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState<number | null>(() =>
    typeof window !== "undefined" && typeof ResizeObserver === "undefined" ? FALLBACK_WIDTH : null,
  );

  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const next = Math.floor(entries[0]?.contentRect.width ?? 0);
      if (next > 0) setWidth(next);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return [ref, width];
}

interface TooltipEntry {
  name?: unknown;
  value?: unknown;
  color?: string;
  dataKey?: unknown;
}

/** Tooltip showing full-precision values; names and numbers stay in text colours. */
function ChartTooltip({
  active,
  payload,
  label,
  labelPrefix,
  maxWidth,
}: {
  active?: boolean;
  payload?: readonly TooltipEntry[];
  label?: unknown;
  labelPrefix?: string;
  /** Keeps the tooltip inside narrow charts. */
  maxWidth?: number;
}) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div
      className="max-w-64 rounded-md border border-border bg-popover px-3 py-2 text-xs shadow-md"
      style={maxWidth ? { maxWidth } : undefined}
    >
      {label !== undefined && label !== "" ? (
        <p className="mb-1 font-medium wrap-break-word text-foreground">
          {labelPrefix ? `${labelPrefix}: ` : ""}
          {String(label)}
        </p>
      ) : null}
      <ul className="space-y-0.5">
        {payload.map((entry, index) => (
          <li
            key={`${String(entry.dataKey ?? entry.name)}-${index}`}
            className="flex items-center gap-2"
          >
            <span
              aria-hidden="true"
              className="size-2 shrink-0 rounded-[2px]"
              style={{ background: entry.color ?? "var(--chart-1)" }}
            />
            <span className="min-w-0 truncate text-muted-foreground">
              {String(entry.name ?? "")}
            </span>
            <span className="tabular ml-auto pl-3 font-medium text-foreground">
              {isNumeric(entry.value) ? formatNumber(entry.value) : String(entry.value ?? "—")}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Legend({ items }: { items: { label: string; color: string }[] }) {
  if (items.length < 2) return null;
  return (
    <ul
      className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground"
      aria-label="Legend"
    >
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="size-2.5 rounded-[2px]"
            style={{ background: item.color }}
          />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

function AxisCaption({ chart }: { chart: Chart }) {
  const parts = [
    chart.x_label ? `x: ${chart.x_label}` : null,
    chart.y_label ? `y: ${chart.y_label}` : null,
  ];
  const text = parts.filter(Boolean).join("  ·  ");
  return text ? <p className="text-xs text-muted-foreground">{text}</p> : null;
}

interface PlotProps {
  chart: Chart;
  data: ChartPoint[];
  series: { item: ChartSeries; color: string }[];
  width: number;
  height: number;
}

function CartesianPlot({ chart, data, series, width, height }: PlotProps) {
  const dense = data.length > 12;
  // Category labels are shortened to the room each one has; the tooltip shows them in full.
  const labelChars = Math.max(3, Math.floor((width - 72) / Math.max(1, data.length) / 6.5));
  const axes = (
    <>
      <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
      <XAxis
        dataKey={chart.x_key}
        tick={AXIS_TICK}
        tickLine={false}
        axisLine={{ stroke: "var(--chart-grid)" }}
        tickFormatter={(value: unknown) => truncateLabel(value, dense ? 14 : labelChars)}
        minTickGap={dense ? 16 : 4}
        interval={dense ? "preserveStartEnd" : 0}
      />
      <YAxis
        tick={AXIS_TICK}
        tickLine={false}
        axisLine={false}
        width={52}
        tickFormatter={(value: unknown) =>
          isNumeric(value) ? formatCompact(value) : String(value)
        }
      />
      <Tooltip
        cursor={
          chart.type === "line"
            ? { stroke: "var(--chart-axis)", strokeDasharray: "3 3" }
            : { fill: "var(--muted)" }
        }
        content={(props) => (
          <ChartTooltip
            active={props.active}
            payload={props.payload}
            label={props.label}
            maxWidth={tooltipWidth(width)}
          />
        )}
      />
    </>
  );

  if (chart.type === "line") {
    return (
      <LineChart
        width={width}
        height={height}
        data={data}
        margin={MARGIN}
        accessibilityLayer={false}
      >
        {axes}
        {series.map(({ item, color }) => (
          <Line
            key={item.key}
            type="linear"
            dataKey={item.key}
            name={item.label}
            stroke={color}
            strokeWidth={2}
            dot={data.length <= 24 ? { r: 2.5, fill: color, strokeWidth: 0 } : false}
            activeDot={{ r: 4 }}
            connectNulls={false}
            isAnimationActive={false}
          />
        ))}
      </LineChart>
    );
  }

  const histogram = chart.type === "histogram";
  return (
    <BarChart
      width={width}
      height={height}
      data={data}
      margin={MARGIN}
      barCategoryGap={histogram ? 1 : "20%"}
      barGap={2}
      accessibilityLayer={false}
    >
      {axes}
      {series.map(({ item, color }) => (
        <Bar
          key={item.key}
          dataKey={item.key}
          name={item.label}
          fill={color}
          radius={histogram ? [2, 2, 0, 0] : [4, 4, 0, 0]}
          maxBarSize={histogram ? undefined : 48}
          isAnimationActive={false}
        />
      ))}
    </BarChart>
  );
}

function PiePlot({ chart, data, width, height }: Omit<PlotProps, "series">) {
  const valueKey = chart.series?.[0]?.key ?? "value";
  const valueLabel = chart.series?.[0]?.label ?? valueKey;
  const radius = Math.max(40, Math.min(width, height) / 2 - 12);
  return (
    <PieChart width={width} height={height} accessibilityLayer={false}>
      <Pie
        data={data}
        dataKey={valueKey}
        nameKey={chart.x_key}
        innerRadius={0}
        outerRadius={radius}
        stroke="var(--card)"
        strokeWidth={2}
        isAnimationActive={false}
      >
        {data.map((point, index) => (
          <Cell key={`${String(point[chart.x_key])}-${index}`} fill={seriesColor(index)} />
        ))}
      </Pie>
      <Tooltip
        content={(props) => (
          <ChartTooltip
            active={props.active}
            payload={props.payload}
            label={valueLabel}
            maxWidth={tooltipWidth(width)}
          />
        )}
      />
    </PieChart>
  );
}

function ScatterPlot({ chart, data, width, height }: Omit<PlotProps, "series">) {
  const xKey = chart.x_key;
  const yKey = chart.y_label ?? "";
  const axis = (dataKey: string, name: string, vertical: boolean) => {
    const common = {
      type: "number" as const,
      dataKey,
      name,
      tick: AXIS_TICK,
      tickLine: false,
      domain: ["auto", "auto"] as [string, string],
      tickFormatter: (value: unknown) => (isNumeric(value) ? formatCompact(value) : String(value)),
    };
    return vertical ? (
      <YAxis {...common} axisLine={false} width={52} />
    ) : (
      <XAxis {...common} axisLine={{ stroke: "var(--chart-grid)" }} />
    );
  };
  return (
    <ScatterChart width={width} height={height} margin={MARGIN} accessibilityLayer={false}>
      <CartesianGrid stroke="var(--chart-grid)" />
      {axis(xKey, chart.x_label || xKey, false)}
      {axis(yKey, yKey, true)}
      <Tooltip
        cursor={{ stroke: "var(--chart-axis)", strokeDasharray: "3 3" }}
        content={(props) => (
          <ChartTooltip
            active={props.active}
            payload={props.payload}
            maxWidth={tooltipWidth(width)}
          />
        )}
      />
      <Scatter data={data} fill="var(--chart-1)" fillOpacity={0.7} isAnimationActive={false} />
    </ScatterChart>
  );
}

function HeatmapPlot({ chart }: { chart: Chart }) {
  const { xs, ys, cells } = buildHeatmap(chart);
  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <table className="border-separate border-spacing-0.5 text-xs">
          <thead>
            <tr>
              <td />
              {xs.map((x) => (
                <th
                  key={x}
                  scope="col"
                  title={x}
                  className="max-w-24 truncate px-1 pb-1 text-center align-bottom font-medium text-muted-foreground"
                >
                  {truncateLabel(x, 12)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ys.map((y) => (
              <tr key={y}>
                <th
                  scope="row"
                  title={y}
                  className="max-w-32 truncate pr-2 text-right font-medium whitespace-nowrap text-muted-foreground"
                >
                  {truncateLabel(y, 16)}
                </th>
                {xs.map((x) => {
                  const value = cells.get(heatmapKey(x, y)) ?? null;
                  return (
                    <td
                      key={x}
                      data-value={value ?? ""}
                      title={`${y} × ${x}: ${value === null ? "no value" : formatNumber(value)}`}
                      className="tabular h-9 min-w-12 rounded-sm px-1.5 text-center text-foreground"
                      style={{ background: heatColor(value) }}
                    >
                      {value === null ? "—" : value.toFixed(2)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-2 text-xs text-muted-foreground" aria-hidden="true">
        <span className="tabular">−1</span>
        <span
          className="h-2 w-40 max-w-full rounded-full"
          style={{
            background:
              "linear-gradient(to right, color-mix(in oklab, var(--heat-negative) 70%, var(--heat-neutral)), var(--heat-neutral), color-mix(in oklab, var(--heat-positive) 70%, var(--heat-neutral)))",
          }}
        />
        <span className="tabular">+1</span>
      </div>
    </div>
  );
}

function Plot({
  chart,
  height,
  children,
}: {
  chart: Chart;
  height: number;
  children: (width: number) => ReactNode;
}) {
  const [ref, width] = useChartWidth();
  return (
    <div
      ref={ref}
      role="img"
      aria-label={describeChart(chart)}
      className="w-full overflow-hidden"
      style={{ height }}
    >
      {width === null ? null : children(width)}
    </div>
  );
}

export interface ChartRendererProps {
  chart: Chart;
  /** Rendered next to the title, e.g. a link to the evidence the chart was built from. */
  source?: ReactNode;
  className?: string;
}

/**
 * Draws a chart exactly as the API specified it. Values are never altered here; the only
 * decisions made are presentational (formatting, colours, and splitting measures of very
 * different scale into separate panels).
 */
export function ChartRenderer({ chart, source, className }: ChartRendererProps) {
  const data = (chart.data ?? []) as ChartPoint[];
  const series = (chart.series ?? []).map((item, index) => ({ item, color: seriesColor(index) }));

  let body: ReactNode;
  let legend: { label: string; color: string }[] = [];

  if (data.length === 0) {
    body = (
      <p className="flex h-32 items-center justify-center rounded-md bg-muted text-sm text-muted-foreground">
        This chart has no data points.
      </p>
    );
  } else if (chart.type === "heatmap") {
    body = (
      <div role="img" aria-label={describeChart(chart)}>
        <HeatmapPlot chart={chart} />
      </div>
    );
  } else if (chart.type === "scatter") {
    body = (
      <Plot chart={chart} height={300}>
        {(width) => <ScatterPlot chart={chart} data={data} width={width} height={300} />}
      </Plot>
    );
  } else if (chart.type === "pie") {
    legend = data.map((point, index) => ({
      label: String(point[chart.x_key] ?? ""),
      color: seriesColor(index),
    }));
    body = (
      <Plot chart={chart} height={260}>
        {(width) => <PiePlot chart={chart} data={data} width={width} height={260} />}
      </Plot>
    );
  } else if (shouldFacet(chart)) {
    body = (
      <div className="grid gap-4 sm:grid-cols-2" data-faceted="true">
        {series.map((entry) => {
          const panel: Chart = {
            ...chart,
            title: `${chart.title} — ${entry.item.label}`,
            series: [entry.item],
          };
          return (
            <div key={entry.item.key} className="min-w-0 space-y-1">
              <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <span
                  aria-hidden="true"
                  className="size-2.5 rounded-[2px]"
                  style={{ background: entry.color }}
                />
                {entry.item.label}
              </p>
              <Plot chart={panel} height={200}>
                {(width) => (
                  <CartesianPlot
                    chart={panel}
                    data={data}
                    series={[entry]}
                    width={width}
                    height={200}
                  />
                )}
              </Plot>
            </div>
          );
        })}
      </div>
    );
  } else {
    legend = series.map((entry) => ({ label: entry.item.label, color: entry.color }));
    body = (
      <Plot chart={chart} height={280}>
        {(width) => (
          <CartesianPlot chart={chart} data={data} series={series} width={width} height={280} />
        )}
      </Plot>
    );
  }

  return (
    <figure
      className={cn(
        "flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-card p-4 shadow-sm transition-shadow hover:shadow-md",
        className,
      )}
    >
      <figcaption className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-0.5">
          <p className="text-sm leading-5 font-medium wrap-break-word">{chart.title}</p>
          <AxisCaption chart={chart} />
        </div>
        {source}
      </figcaption>
      <Legend items={legend} />
      {body}
    </figure>
  );
}
