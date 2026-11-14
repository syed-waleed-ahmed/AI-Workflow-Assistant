"use client";

import { ChevronRight, Download } from "lucide-react";
import { createContext, useContext, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableScroll,
} from "@/components/ui/table";
import { errorMessage } from "@/lib/api/client";
import type { DataTable, EvidenceRecord, Scalar } from "@/lib/api/types";
import { formatCell, formatInteger, humanize } from "@/lib/format";
import { cn } from "@/lib/utils";

interface EvidenceContextValue {
  /** Ids of the evidence records this report contains. */
  known: ReadonlySet<string>;
  /** Expands the record in the Methodology section and moves focus to it. */
  open: (id: string) => void;
}

export const EvidenceContext = createContext<EvidenceContextValue>({
  known: new Set(),
  open: () => undefined,
});

/** A citation: clicking it reveals the computation a figure came from. */
export function EvidenceChip({ id, className }: { id: string; className?: string }) {
  const { known, open } = useContext(EvidenceContext);
  if (!known.has(id)) {
    return (
      <Badge
        tone="outline"
        className={cn("tabular font-mono", className)}
        title="This evidence record is not part of the report"
      >
        {id}
      </Badge>
    );
  }
  return (
    <button
      type="button"
      onClick={() => open(id)}
      aria-label={`Show evidence ${id}`}
      className={cn(
        "tabular inline-flex h-5 items-center rounded-sm border border-border bg-background px-1.5 font-mono text-xs font-medium text-accent-text transition-colors hover:border-ring hover:bg-accent-soft",
        className,
      )}
    >
      {id}
    </button>
  );
}

export function EvidenceChips({ ids, className }: { ids: readonly string[]; className?: string }) {
  if (ids.length === 0) return null;
  return (
    <ul className={cn("flex flex-wrap items-center gap-1", className)} aria-label="Evidence">
      {ids.map((id) => (
        <li key={id} className="flex">
          <EvidenceChip id={id} />
        </li>
      ))}
    </ul>
  );
}

function isNumberColumn(table: DataTable, index: number): boolean {
  let numeric = false;
  for (const row of table.rows) {
    const value = row[index];
    if (value === null || value === undefined) continue;
    if (typeof value !== "number") return false;
    numeric = true;
  }
  return numeric;
}

/** A computed result table, shown exactly as the tool returned it. */
export function EvidenceTable({ table, label }: { table: DataTable; label: string }) {
  const numeric = table.columns.map((_, index) => isNumberColumn(table, index));
  return (
    <div className="space-y-1.5">
      <TableScroll label={label} className="max-h-80">
        <Table>
          <TableHeader>
            <TableRow>
              {table.columns.map((column, index) => (
                <TableHead
                  key={`${column}-${index}`}
                  className={cn(numeric[index] && "text-right")}
                >
                  {column}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {table.rows.map((row, rowIndex) => (
              <TableRow key={rowIndex}>
                {table.columns.map((column, index) => (
                  <TableCell
                    key={`${column}-${index}`}
                    className={cn("whitespace-nowrap", numeric[index] && "tabular text-right")}
                  >
                    {formatCell(row[index] as Scalar | undefined)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableScroll>
      {table.truncated || table.total_rows > table.rows.length ? (
        <p className="text-xs text-muted-foreground">
          Showing {formatInteger(table.rows.length)} of {formatInteger(table.total_rows)} rows.
        </p>
      ) : null}
    </div>
  );
}

function ScalarList({ scalars }: { scalars: Record<string, Scalar> }) {
  const entries = Object.entries(scalars);
  if (entries.length === 0) return null;
  return (
    <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
      {entries.map(([key, value]) => (
        <div
          key={key}
          className="flex min-w-0 items-baseline justify-between gap-3 border-b border-border py-1"
        >
          <dt className="min-w-0 wrap-break-word text-muted-foreground">{humanize(key)}</dt>
          <dd className="tabular shrink-0 font-medium">{formatCell(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

interface EvidenceItemProps {
  record: EvidenceRecord;
  expanded: boolean;
  onToggle: () => void;
  domId: string;
  /** Downloads this record's table as CSV; omitted when the report is not stored (the example). */
  onDownloadTable?: (evidenceId: string) => Promise<unknown>;
}

function SubHeading({ children }: { children: string }) {
  return (
    <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{children}</p>
  );
}

export function EvidenceItem({
  record,
  expanded,
  onToggle,
  domId,
  onDownloadTable,
}: EvidenceItemProps) {
  const [downloading, setDownloading] = useState(false);
  const panelId = `${domId}-panel`;
  const hasArguments = Object.keys(record.arguments ?? {}).length > 0;

  const download = async () => {
    if (!onDownloadTable) return;
    setDownloading(true);
    try {
      await onDownloadTable(record.id);
    } catch (error) {
      toast.error(errorMessage(error, "The table could not be downloaded."));
    } finally {
      setDownloading(false);
    }
  };

  return (
    <li id={domId} className="scroll-mt-24 rounded-lg border border-border bg-card">
      <button
        type="button"
        id={`${domId}-trigger`}
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={onToggle}
        className="flex w-full items-start gap-3 rounded-lg px-4 py-3 text-left transition-colors hover:bg-muted"
      >
        <ChevronRight
          aria-hidden="true"
          data-print="hide"
          className={cn(
            "mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform",
            expanded && "rotate-90",
          )}
        />
        <span className="tabular mt-px shrink-0 font-mono text-xs font-semibold text-accent-text">
          {record.id}
        </span>
        <span className="min-w-0 flex-1 text-sm leading-5 font-medium wrap-break-word">
          {record.label}
        </span>
        <span className="hidden shrink-0 items-center gap-1.5 sm:flex">
          {record.ok ? null : <Badge tone="danger">Failed</Badge>}
          <Badge tone="neutral" className="font-mono">
            {record.tool}
          </Badge>
        </span>
      </button>
      <div
        id={panelId}
        role="region"
        aria-labelledby={`${domId}-trigger`}
        hidden={!expanded}
        data-print="expand"
        className="space-y-4 border-t border-border px-4 py-4"
      >
        <div className="space-y-1">
          <SubHeading>Result</SubHeading>
          <p className="text-sm leading-6 wrap-break-word">{record.summary}</p>
        </div>

        {(record.notes ?? []).length > 0 ? (
          <div className="space-y-1">
            <SubHeading>Notes</SubHeading>
            <ul className="list-disc space-y-1 pl-5 text-sm leading-6 text-muted-foreground">
              {(record.notes ?? []).map((note, index) => (
                <li key={index}>{note}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {Object.keys(record.scalars ?? {}).length > 0 ? (
          <div className="space-y-1">
            <SubHeading>Computed values</SubHeading>
            <ScalarList scalars={(record.scalars ?? {}) as Record<string, Scalar>} />
          </div>
        ) : null}

        {record.table ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <SubHeading>Data table</SubHeading>
              {onDownloadTable ? (
                <Button
                  variant="outline"
                  size="sm"
                  data-print="hide"
                  onClick={download}
                  loading={downloading}
                  aria-label={`Download the ${record.id} table as CSV`}
                >
                  {downloading ? null : <Download aria-hidden="true" />}
                  CSV
                </Button>
              ) : null}
            </div>
            <EvidenceTable table={record.table} label={`${record.id} data table`} />
          </div>
        ) : null}

        <div className="space-y-1">
          <SubHeading>Computation</SubHeading>
          <p className="text-sm text-muted-foreground">
            Tool <code className="font-mono text-[13px] text-foreground">{record.tool}</code>
            {hasArguments ? " called with:" : " called with no arguments."}
          </p>
          {hasArguments ? (
            <pre
              className="max-h-64 overflow-auto rounded-md bg-muted p-3 font-mono text-xs leading-5"
              tabIndex={0}
            >
              {JSON.stringify(record.arguments, null, 2)}
            </pre>
          ) : null}
        </div>
      </div>
    </li>
  );
}
