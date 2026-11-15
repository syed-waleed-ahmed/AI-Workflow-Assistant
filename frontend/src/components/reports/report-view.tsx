"use client";

import { createElement, useCallback, useId, useMemo, useState, type ReactNode } from "react";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Level, ReportContent } from "@/lib/api/types";
import { DateTime } from "@/components/common/date-time";
import { formatInteger, formatPercent, pluralize } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ChartRenderer } from "./chart-renderer";
import { EvidenceChip, EvidenceChips, EvidenceContext, EvidenceItem } from "./evidence";
import { VerificationBadge } from "./verification-badge";

const LEVEL_TONE: Record<Level, BadgeTone> = { high: "accent", medium: "neutral", low: "outline" };
/** A coloured left edge that lets the eye find the most important items first. */
const LEVEL_EDGE: Record<Level, string> = {
  high: "border-l-primary",
  medium: "border-l-warning-text/70",
  low: "border-l-border",
};

type HeadingLevel = 1 | 2 | 3;

function Heading({
  level,
  className,
  children,
  id,
}: {
  level: number;
  className?: string;
  children: ReactNode;
  id?: string;
}) {
  return createElement(`h${Math.min(6, Math.max(1, level))}`, { className, id }, children);
}

function Section({
  title,
  level,
  count,
  children,
  className,
}: {
  title: string;
  level: number;
  count?: number;
  children: ReactNode;
  className?: string;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={cn("space-y-3", className)}>
      <Heading
        level={level}
        id={id}
        className="flex items-baseline gap-2 text-sm font-semibold tracking-tight"
      >
        {title}
        {count !== undefined ? (
          <span className="tabular text-xs font-normal text-muted-foreground">{count}</span>
        ) : null}
      </Heading>
      {children}
    </section>
  );
}

export interface ReportViewProps {
  report: ReportContent;
  /** Heading level of the report title; section headings follow from it. */
  headingLevel?: HeadingLevel;
  /** Rendered beside the title: export menu, link to the full report… */
  actions?: ReactNode;
  /** Enables per-table CSV downloads. Omitted for the unauthenticated example. */
  onDownloadTable?: (evidenceId: string) => Promise<unknown>;
  className?: string;
}

/**
 * Renders a structured report. Every metric and finding carries chips for the evidence
 * records it cites; activating one opens that record in the Methodology section.
 */
export function ReportView({
  report,
  headingLevel = 2,
  actions,
  onDownloadTable,
  className,
}: ReportViewProps) {
  const domPrefix = useId();
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const sectionLevel = headingLevel + 1;
  const itemLevel = headingLevel + 2;

  const evidenceDomId = useCallback((id: string) => `${domPrefix}evidence-${id}`, [domPrefix]);

  const openEvidence = useCallback(
    (id: string) => {
      setExpanded((current) => (current.has(id) ? current : new Set(current).add(id)));
      // Wait for the panel to render before moving to it.
      requestAnimationFrame(() => {
        const element = document.getElementById(evidenceDomId(id));
        if (!element) return;
        const reduceMotion =
          window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
        element.scrollIntoView?.({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
        document.getElementById(`${evidenceDomId(id)}-trigger`)?.focus({ preventScroll: true });
      });
    },
    [evidenceDomId],
  );

  const toggleEvidence = useCallback((id: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const context = useMemo(
    () => ({ known: new Set(report.methodology.map((record) => record.id)), open: openEvidence }),
    [report.methodology, openEvidence],
  );

  const overview = report.dataset_overview;
  const allExpanded = report.methodology.length > 0 && expanded.size === report.methodology.length;

  return (
    <EvidenceContext.Provider value={context}>
      <article className={cn("flex min-w-0 flex-col gap-8", className)}>
        <header className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 space-y-1.5">
              <Heading
                level={headingLevel}
                className={cn(
                  "font-semibold tracking-tight wrap-break-word",
                  headingLevel === 1 ? "text-2xl leading-8" : "text-lg leading-7",
                )}
              >
                {report.title}
              </Heading>
              <p className="text-sm leading-6 wrap-break-word text-muted-foreground">
                <span className="font-medium text-foreground">Question:</span> {report.question}
              </p>
            </div>
            {actions ? (
              <div data-print="hide" className="flex shrink-0 flex-wrap items-center gap-2">
                {actions}
              </div>
            ) : null}
          </div>

          <VerificationBadge verification={report.verification} />

          <dl className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
            <div className="flex gap-1.5">
              <dt>Dataset</dt>
              <dd className="font-medium break-all text-foreground">{overview.name}</dd>
            </div>
            <div className="flex gap-1.5">
              <dt>Size</dt>
              <dd className="tabular font-medium text-foreground">
                {formatInteger(overview.rows)} rows × {formatInteger(overview.columns)} columns
              </dd>
            </div>
            <div className="flex gap-1.5">
              <dt>Missing cells</dt>
              <dd className="tabular font-medium text-foreground">
                {formatPercent(overview.missing_cells_pct, 2)}
              </dd>
            </div>
            <div className="flex gap-1.5">
              <dt>Generated</dt>
              <dd className="font-medium text-foreground">
                <DateTime iso={report.generated_at} />
              </dd>
            </div>
            <div className="flex gap-1.5">
              <dt>Model</dt>
              <dd className="font-mono font-medium text-foreground">{report.model}</dd>
            </div>
          </dl>
        </header>

        <Section title="Summary" level={sectionLevel}>
          <p className="max-w-3xl text-[15px] leading-7 wrap-break-word">
            {report.executive_summary}
          </p>
        </Section>

        {report.key_metrics.length > 0 ? (
          <Section title="Key metrics" level={sectionLevel}>
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {report.key_metrics.map((metric, index) => (
                <li
                  key={`${metric.label}-${index}`}
                  className="relative flex min-w-0 flex-col gap-1.5 overflow-hidden rounded-xl border border-border bg-card p-4 shadow-sm before:absolute before:inset-x-0 before:top-0 before:h-0.75 before:bg-brand-gradient"
                >
                  <p className="text-xs leading-4 text-muted-foreground">{metric.label}</p>
                  <p className="tabular text-2xl leading-8 font-semibold tracking-tight wrap-break-word">
                    {metric.value}
                  </p>
                  {metric.context ? (
                    <p className="text-xs leading-4 text-muted-foreground">{metric.context}</p>
                  ) : null}
                  <EvidenceChips ids={metric.evidence_ids} className="mt-auto pt-1" />
                </li>
              ))}
            </ul>
          </Section>
        ) : null}

        {report.findings.length > 0 ? (
          <Section title="Findings" level={sectionLevel} count={report.findings.length}>
            <ol className="space-y-3">
              {report.findings.map((finding, index) => (
                <li
                  key={`${finding.title}-${index}`}
                  className={cn(
                    "rounded-xl border border-l-[3px] border-border bg-card p-4 shadow-sm",
                    LEVEL_EDGE[finding.significance],
                  )}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <Heading
                      level={itemLevel}
                      className="min-w-0 text-sm leading-5 font-semibold wrap-break-word"
                    >
                      {finding.title}
                    </Heading>
                    <Badge tone={LEVEL_TONE[finding.significance]}>
                      {finding.significance} significance
                    </Badge>
                  </div>
                  <p className="mt-1.5 max-w-3xl text-sm leading-6 wrap-break-word text-muted-foreground">
                    {finding.detail}
                  </p>
                  <EvidenceChips ids={finding.evidence_ids} className="mt-2.5" />
                </li>
              ))}
            </ol>
          </Section>
        ) : null}

        {report.visualizations.length > 0 ? (
          <Section title="Charts" level={sectionLevel}>
            <div className="grid items-start gap-4 xl:grid-cols-2">
              {report.visualizations.map((visualization, index) => (
                <ChartRenderer
                  key={`${visualization.evidence_id}-${index}`}
                  chart={visualization.chart}
                  source={<EvidenceChip id={visualization.evidence_id} className="shrink-0" />}
                />
              ))}
            </div>
          </Section>
        ) : null}

        {report.anomalies.length > 0 ? (
          <Section title="Anomalies" level={sectionLevel} count={report.anomalies.length}>
            <ul className="space-y-3">
              {report.anomalies.map((anomaly, index) => (
                <li
                  key={`${anomaly.title}-${index}`}
                  className="rounded-xl border border-l-[3px] border-border border-l-warning-text/70 bg-card p-4 shadow-sm"
                >
                  <Heading
                    level={itemLevel}
                    className="text-sm leading-5 font-semibold wrap-break-word"
                  >
                    {anomaly.title}
                  </Heading>
                  <p className="mt-1.5 max-w-3xl text-sm leading-6 wrap-break-word text-muted-foreground">
                    {anomaly.detail}
                  </p>
                  <EvidenceChips ids={anomaly.evidence_ids} className="mt-2.5" />
                </li>
              ))}
            </ul>
          </Section>
        ) : null}

        {report.recommendations.length > 0 ? (
          <Section
            title="Recommendations"
            level={sectionLevel}
            count={report.recommendations.length}
          >
            <ol className="space-y-3">
              {report.recommendations.map((recommendation, index) => (
                <li
                  key={`${recommendation.action}-${index}`}
                  className={cn(
                    "rounded-xl border border-l-[3px] border-border bg-card p-4 shadow-sm",
                    LEVEL_EDGE[recommendation.priority],
                  )}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <p className="min-w-0 text-sm leading-5 font-semibold wrap-break-word">
                      {recommendation.action}
                    </p>
                    <Badge tone={LEVEL_TONE[recommendation.priority]}>
                      {recommendation.priority} priority
                    </Badge>
                  </div>
                  <p className="mt-1.5 max-w-3xl text-sm leading-6 wrap-break-word text-muted-foreground">
                    {recommendation.rationale}
                  </p>
                </li>
              ))}
            </ol>
          </Section>
        ) : null}

        {report.data_quality.length > 0 || report.limitations.length > 0 ? (
          <div className="grid gap-8 md:grid-cols-2">
            {report.data_quality.length > 0 ? (
              <Section title="Data quality" level={sectionLevel}>
                <ul className="list-disc space-y-1.5 pl-5 text-sm leading-6 text-muted-foreground">
                  {report.data_quality.map((note, index) => (
                    <li key={index} className="wrap-break-word">
                      {note}
                    </li>
                  ))}
                </ul>
              </Section>
            ) : null}
            {report.limitations.length > 0 ? (
              <Section title="Limitations" level={sectionLevel}>
                <ul className="list-disc space-y-1.5 pl-5 text-sm leading-6 text-muted-foreground">
                  {report.limitations.map((note, index) => (
                    <li key={index} className="wrap-break-word">
                      {note}
                    </li>
                  ))}
                </ul>
              </Section>
            ) : null}
          </div>
        ) : null}

        <Section title="Methodology" level={sectionLevel}>
          <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
            Every figure above was computed from the dataset by a deterministic tool. Each record
            below is one of those computations: what was run, with which arguments, and what it
            returned.
          </p>

          {report.plan.length > 0 ? (
            <div className="space-y-1.5">
              <Heading
                level={itemLevel}
                className="text-xs font-medium tracking-wide text-muted-foreground uppercase"
              >
                Analysis plan
              </Heading>
              <ol className="list-decimal space-y-1 pl-5 text-sm leading-6 text-muted-foreground">
                {report.plan.map((step, index) => (
                  <li key={index} className="wrap-break-word">
                    {step}
                  </li>
                ))}
              </ol>
            </div>
          ) : null}

          {report.methodology.length > 0 ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Heading
                  level={itemLevel}
                  className="text-xs font-medium tracking-wide text-muted-foreground uppercase"
                >
                  Evidence · {pluralize(report.methodology.length, "computation")}
                </Heading>
                <Button
                  variant="ghost"
                  size="sm"
                  data-print="hide"
                  onClick={() =>
                    setExpanded(
                      allExpanded
                        ? new Set()
                        : new Set(report.methodology.map((record) => record.id)),
                    )
                  }
                >
                  {allExpanded ? "Collapse all" : "Expand all"}
                </Button>
              </div>
              <ul className="space-y-2">
                {report.methodology.map((record) => (
                  <EvidenceItem
                    key={record.id}
                    record={record}
                    domId={evidenceDomId(record.id)}
                    expanded={expanded.has(record.id)}
                    onToggle={() => toggleEvidence(record.id)}
                    onDownloadTable={onDownloadTable}
                  />
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No computations were recorded for this report.
            </p>
          )}

          {(report.verification.notes ?? []).length > 0 ? (
            <div className="space-y-1.5">
              <Heading
                level={itemLevel}
                className="text-xs font-medium tracking-wide text-muted-foreground uppercase"
              >
                Verification
              </Heading>
              <ul className="list-disc space-y-1 pl-5 text-sm leading-6 text-muted-foreground">
                {(report.verification.notes ?? []).map((note, index) => (
                  <li key={index} className="wrap-break-word">
                    {note}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </Section>
      </article>
    </EvidenceContext.Provider>
  );
}
