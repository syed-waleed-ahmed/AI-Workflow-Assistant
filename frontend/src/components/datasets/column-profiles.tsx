import type { ColumnProfile, Scalar } from "@/lib/api/types";
import { formatCell, formatInteger, formatPercent, formatReadable, humanize } from "@/lib/format";
import { KindBadge } from "./badges";

function TopValues({ column, rowCount }: { column: ColumnProfile; rowCount: number }) {
  const values = (column.top_values ?? []).slice(0, 5);
  if (values.length === 0) return null;
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-muted-foreground">Most frequent values</p>
      <ul className="space-y-1">
        {values.map((entry, index) => {
          const count = typeof entry["count"] === "number" ? entry["count"] : 0;
          const share = rowCount > 0 ? (count / rowCount) * 100 : 0;
          return (
            <li key={index} className="text-xs">
              <div className="flex items-baseline justify-between gap-3">
                <span
                  className="min-w-0 truncate"
                  title={formatCell(entry["value"] as Scalar | undefined)}
                >
                  {formatCell(entry["value"] as Scalar | undefined)}
                </span>
                <span className="tabular shrink-0 text-muted-foreground">
                  {formatInteger(count)} · {formatPercent(share)}
                </span>
              </div>
              <div className="mt-0.5 h-1 rounded-full bg-muted" aria-hidden="true">
                <div
                  className="h-full rounded-full bg-(--chart-1)"
                  style={{ width: `${Math.min(100, share)}%` }}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Stats({ stats }: { stats: Record<string, Scalar> }) {
  const entries = Object.entries(stats).filter(([, value]) => value !== null);
  if (entries.length === 0) return null;
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
      {entries.map(([key, value]) => (
        <div key={key} className="flex min-w-0 items-baseline justify-between gap-2">
          <dt className="truncate text-muted-foreground">{humanize(key)}</dt>
          <dd className="tabular min-w-0 truncate font-medium" title={formatCell(value)}>
            {typeof value === "number" ? formatReadable(value) : formatCell(value)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function ColumnCard({ column, rowCount }: { column: ColumnProfile; rowCount: number }) {
  const samples = (column.sample_values ?? []).slice(0, 4);
  return (
    <li className="flex min-w-0 flex-col gap-3 rounded-lg border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold" title={column.name}>
            {column.name}
          </h3>
          <p className="font-mono text-xs text-muted-foreground">{column.dtype}</p>
        </div>
        <KindBadge kind={column.kind} />
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
        <div className="flex items-baseline justify-between gap-2">
          <dt className="text-muted-foreground">Missing</dt>
          <dd className="tabular font-medium">
            {formatPercent(column.missing_pct)}
            <span className="font-normal text-muted-foreground">
              {" "}
              ({formatInteger(column.missing)})
            </span>
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-2">
          <dt className="text-muted-foreground">Unique</dt>
          <dd className="tabular font-medium">{formatInteger(column.unique)}</dd>
        </div>
      </dl>

      {column.stats ? <Stats stats={column.stats as Record<string, Scalar>} /> : null}
      <TopValues column={column} rowCount={rowCount} />

      {!column.top_values?.length && samples.length > 0 ? (
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">Sample values</p>
          <p
            className="truncate text-xs"
            title={samples.map((value) => formatCell(value as Scalar)).join(", ")}
          >
            {samples.map((value) => formatCell(value as Scalar)).join(", ")}
          </p>
        </div>
      ) : null}
    </li>
  );
}

/** One card per column: inferred kind, completeness, and the profile statistics the API computed. */
export function ColumnProfiles({
  columns,
  rowCount,
}: {
  columns: readonly ColumnProfile[];
  rowCount: number;
}) {
  if (columns.length === 0) {
    return <p className="text-sm text-muted-foreground">This dataset has no columns.</p>;
  }
  return (
    <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {columns.map((column) => (
        <ColumnCard key={column.name} column={column} rowCount={rowCount} />
      ))}
    </ul>
  );
}
