"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import type { AnalysisSummary } from "@/lib/api/types";
import { formatRelative, pluralize } from "@/lib/format";
import { useNow } from "@/lib/use-now";
import { cn } from "@/lib/utils";
import { StatusBadge } from "./status-badge";

interface AnalysisListProps {
  items: readonly AnalysisSummary[];
  /** Hides the dataset name when the list is already scoped to one dataset. */
  showDataset?: boolean;
  /** Controls for a row (export, delete). They sit beside the link, never inside it. */
  renderActions?: (analysis: AnalysisSummary) => ReactNode;
  className?: string;
}

/**
 * Analyses as rows linking to their workspace, each with its current status. The title link is
 * stretched over the whole row, so the row is one click target while the action buttons stay
 * separate, focusable controls.
 */
export function AnalysisList({
  items,
  showDataset = true,
  renderActions,
  className,
}: AnalysisListProps) {
  const now = useNow(30_000);
  return (
    <ul
      className={cn(
        "divide-y divide-border rounded-xl border border-border bg-card shadow-sm",
        className,
      )}
    >
      {items.map((analysis) => {
        const actions = renderActions?.(analysis);
        return (
          <li
            key={analysis.id}
            className="relative flex items-center gap-3 px-4 py-3 transition-colors first:rounded-t-xl last:rounded-b-xl hover:bg-muted/60"
          >
            <div className="min-w-0 flex-1 space-y-1">
              <p className="truncate text-sm font-medium">
                <Link
                  href={`/app/analyses/${analysis.id}`}
                  className="after:absolute after:inset-0 after:rounded-[inherit] focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-ring"
                >
                  {analysis.title}
                </Link>
              </p>
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
            {actions ? (
              <div className="relative z-10 flex shrink-0 items-center gap-1">{actions}</div>
            ) : (
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            )}
          </li>
        );
      })}
    </ul>
  );
}
