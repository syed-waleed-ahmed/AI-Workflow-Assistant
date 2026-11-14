"use client";

import { Check, ChevronRight, CircleDashed, Hourglass, Loader2, Minus } from "lucide-react";
import { useState } from "react";
import { buildTimeline, type TimelineStep } from "@/lib/analysis/timeline";
import type { AnalysisEvent, AnalysisStatus } from "@/lib/api/types";
import { isActiveStatus } from "@/lib/api/types";
import { formatDuration, pluralize } from "@/lib/format";
import { useNow } from "@/lib/use-now";
import { cn } from "@/lib/utils";

function StepIcon({ step }: { step: TimelineStep }) {
  const base = "flex size-5 shrink-0 items-center justify-center rounded-full";
  if (step.state === "running") {
    const Icon = step.waitSeconds !== undefined ? Hourglass : Loader2;
    return (
      <span className={cn(base, "bg-accent-soft text-accent-text")}>
        <Icon
          className={cn("size-3", step.waitSeconds === undefined && "animate-spin")}
          aria-hidden="true"
        />
      </span>
    );
  }
  if (step.state === "stopped") {
    return (
      <span className={cn(base, "bg-muted text-muted-foreground")}>
        <Minus className="size-3" aria-hidden="true" />
      </span>
    );
  }
  return (
    <span className={cn(base, "bg-success-soft text-success-text")}>
      <Check className="size-3" aria-hidden="true" />
    </span>
  );
}

const STATE_TEXT: Record<TimelineStep["state"], string> = {
  running: "in progress",
  done: "done",
  stopped: "stopped",
};

function StepRow({ step, last }: { step: TimelineStep; last: boolean }) {
  return (
    <li
      className="relative flex gap-3 pb-3 last:pb-0"
      data-state={step.state}
      data-kind={step.kind}
    >
      {last ? null : (
        <span
          aria-hidden="true"
          className="absolute top-5 bottom-0 left-2.5 w-px -translate-x-1/2 bg-border"
        />
      )}
      <StepIcon step={step} />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="flex flex-wrap items-center gap-x-2 text-sm leading-5">
          <span
            className={cn(
              "wrap-break-word",
              step.state === "running" ? "font-medium" : "text-muted-foreground",
            )}
          >
            {step.label}
          </span>
          {step.evidenceId ? (
            <span className="tabular rounded-sm bg-muted px-1 font-mono text-xs text-muted-foreground">
              {step.evidenceId}
            </span>
          ) : null}
          {step.kind === "tool" && step.state === "stopped" ? (
            <span className="text-xs text-muted-foreground">(no result)</span>
          ) : (
            <span className="sr-only">({STATE_TEXT[step.state]})</span>
          )}
        </p>
        {step.kind === "plan" && (step.objective || (step.planSteps?.length ?? 0) > 0) ? (
          <div className="rounded-md border border-border bg-background px-3 py-2 text-sm leading-6">
            {step.objective ? <p className="wrap-break-word">{step.objective}</p> : null}
            {step.planSteps && step.planSteps.length > 0 ? (
              <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-muted-foreground">
                {step.planSteps.map((item, index) => (
                  <li key={index} className="wrap-break-word">
                    {item}
                  </li>
                ))}
              </ol>
            ) : null}
          </div>
        ) : null}
      </div>
    </li>
  );
}

function Elapsed({ since }: { since: string }) {
  const now = useNow(1000);
  const started = new Date(since).getTime();
  if (Number.isNaN(started)) return null;
  return <span className="tabular">{formatDuration((now - started) / 1000)} elapsed</span>;
}

export interface ActivityTimelineProps {
  events: readonly AnalysisEvent[];
  status: AnalysisStatus;
  /** When the run was queued or started, for the elapsed-time display. */
  since?: string | null;
  className?: string;
}

/**
 * The live progress of an analysis. Each row is a step the backend reported (loading,
 * planning, each computation, verification); nothing here is simulated. Once the run has
 * finished the list collapses to a one-line summary.
 */
export function ActivityTimeline({ events, status, since, className }: ActivityTimelineProps) {
  const active = isActiveStatus(status);
  const steps = buildTimeline(events, status);
  const [open, setOpen] = useState(false);
  const expanded = active || open;
  const current = active ? steps.findLast((step) => step.state === "running") : undefined;

  if (!active && steps.length === 0) return null;

  const list = (
    <ol className="flex flex-col" aria-label="Analysis activity">
      {steps.map((step, index) => (
        <StepRow key={step.key} step={step} last={index === steps.length - 1} />
      ))}
    </ol>
  );

  if (!active) {
    return (
      <div
        className={cn("rounded-lg border border-border bg-surface", className)}
        data-print="hide"
      >
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setOpen((value) => !value)}
          className="flex w-full items-center gap-2 rounded-lg px-4 py-2.5 text-left text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronRight
            className={cn("size-4 transition-transform", expanded && "rotate-90")}
            aria-hidden="true"
          />
          Activity · {pluralize(steps.length, "step")}
        </button>
        {expanded ? <div className="border-t border-border px-4 py-3">{list}</div> : null}
      </div>
    );
  }

  return (
    <div
      className={cn("rounded-lg border border-border bg-surface p-4", className)}
      aria-busy="true"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <p className="flex items-center gap-2 text-sm font-medium">
          <Loader2 className="size-4 animate-spin text-accent-text" aria-hidden="true" />
          {status === "queued" ? "Queued" : "Analysing your data"}
        </p>
        <p className="text-xs text-muted-foreground">{since ? <Elapsed since={since} /> : null}</p>
      </div>

      {steps.length === 0 ? (
        <p className="flex items-center gap-3 text-sm text-muted-foreground">
          <CircleDashed className="size-5 shrink-0" aria-hidden="true" />
          Waiting for a worker to pick this up…
        </p>
      ) : (
        list
      )}

      <p className="mt-3 border-t border-border pt-3 text-xs leading-5 text-muted-foreground">
        Analyses usually take 40–120 seconds on the free model tier. You can leave this page; the
        analysis keeps running and the result will be here when you come back.
      </p>

      {/* Announces only the newest step, not the whole list, to screen-reader users. */}
      <p className="sr-only" role="status" aria-live="polite">
        {current ? current.label : status === "queued" ? "Analysis queued" : ""}
      </p>
    </div>
  );
}
