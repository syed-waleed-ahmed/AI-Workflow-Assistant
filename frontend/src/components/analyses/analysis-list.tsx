"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";
import type { AnalysisSummary } from "@/lib/api/types";
import { formatRelative, pluralize } from "@/lib/format";
import { useNow } from "@/lib/use-now";
import { cn } from "@/lib/utils";
import { StatusBadge } from "./status-badge";

interface AnalysisListProps {
  items: readonly AnalysisSummary[];
  /** Hides the dataset name when the list is already scoped to one dataset. */
  showDataset?: boolean;
  className?: string;
}

/** Analyses as rows linking to their workspace, each with its current status. */
export function AnalysisList({ items, showDataset = true, className }: AnalysisListProps) {
  const now = useNow(30_000);
  return (
    <ul className={cn("divide-y divide-border rounded-lg border border-border bg-card", className)}>
      {items.map((analysis) => (
        <li key={analysis.id}>
          <Link
            href={`/app/analyses/${analysis.id}`}
            className="flex items-center gap-3 px-4 py-3 transition-colors first:rounded-t-lg last:rounded-b-lg hover:bg-muted/60"
          >
            <div className="min-w-0 flex-1 space-y-1">
              <p className="truncate text-sm font-medium">{analysis.title}</p>
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                <StatusBadge status={analysis.status} />
                {showDataset ? (
                  <span className="max-w-48 truncate">{analysis.dataset_name}</span>
                ) : null}
                {analysis.turn > 1 ? <span>{pluralize(analysis.turn, "question")}</span> : null}
                <span>{formatRelative(analysis.created_at, now)}</span>
              </p>
              {analysis.status === "failed" && analysis.error ? (
                <p className="truncate text-xs text-destructive-text">{analysis.error}</p>
              ) : null}
            </div>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          </Link>
        </li>
      ))}
    </ul>
  );
}
