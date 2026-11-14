"use client";

import {
  ArrowUpRight,
  Ban,
  CircleAlert,
  Database,
  MoreHorizontal,
  RotateCw,
  Square,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { PageContainer, PageHeader } from "@/components/common/page-header";
import { ErrorState } from "@/components/common/states";
import { ReportExportMenu } from "@/components/reports/report-export-menu";
import { ReportView } from "@/components/reports/report-view";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LoadingRegion, Skeleton } from "@/components/ui/skeleton";
import { ApiError, errorMessage } from "@/lib/api/client";
import { downloadReportExport } from "@/lib/api/download";
import type { Analysis, AnalysisEvent, AnalysisMessage, AnalysisStatus } from "@/lib/api/types";
import { isActiveStatus } from "@/lib/api/types";
import { formatDateTime } from "@/lib/format";
import {
  useAnalysis,
  useAnalysisEvents,
  useCancelAnalysis,
  useDatasetSuggestions,
  useDeleteAnalysis,
  useFollowUp,
  useReport,
} from "@/lib/query/hooks";
import { ActivityTimeline } from "./activity-timeline";
import { QuestionComposer } from "./question-composer";
import { StatusBadge } from "./status-badge";

interface Turn {
  turn: number;
  question?: AnalysisMessage;
  answer?: AnalysisMessage;
}

/** Groups the flat message list into question/answer pairs, one per turn. */
export function groupTurns(messages: readonly AnalysisMessage[]): Turn[] {
  const turns = new Map<number, Turn>();
  for (const message of messages) {
    const entry = turns.get(message.turn) ?? { turn: message.turn };
    if (message.role === "user") entry.question = message;
    else entry.answer = message;
    turns.set(message.turn, entry);
  }
  return [...turns.values()].sort((a, b) => a.turn - b.turn);
}

function ReportSkeleton() {
  return (
    <LoadingRegion label="Loading the report" className="space-y-4">
      <Skeleton className="h-7 w-2/3" />
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-20 w-full" />
      <div className="grid gap-3 sm:grid-cols-3">
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
    </LoadingRegion>
  );
}

/** One assistant answer: fetches the stored report and renders it inline. */
function ReportMessage({ reportId }: { reportId: string }) {
  const report = useReport(reportId);
  if (report.isPending) return <ReportSkeleton />;
  if (report.isError) {
    return (
      <ErrorState
        error={report.error}
        title="The report could not be loaded"
        onRetry={() => void report.refetch()}
        retrying={report.isFetching}
      />
    );
  }
  return (
    <ReportView
      report={report.data.content}
      headingLevel={2}
      onDownloadTable={(evidenceId) => downloadReportExport(reportId, "csv", evidenceId)}
      actions={
        <>
          <Button variant="outline" size="sm" asChild>
            <Link href={`/app/reports/${reportId}`}>
              Open report
              <ArrowUpRight aria-hidden="true" />
            </Link>
          </Button>
          <ReportExportMenu reportId={reportId} />
        </>
      }
    />
  );
}

function QuestionBubble({ message }: { message: AnalysisMessage }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[min(100%,42rem)] rounded-lg bg-muted px-4 py-3">
        <p className="mb-1 text-xs font-medium text-muted-foreground">You asked</p>
        <p className="text-sm leading-6 wrap-break-word whitespace-pre-wrap">{message.content}</p>
      </div>
    </div>
  );
}

interface TurnViewProps {
  turn: Turn;
  isCurrent: boolean;
  status: AnalysisStatus;
  error: string | null;
  events: readonly AnalysisEvent[];
  since: string | null;
  refreshing: boolean;
  canRetry: boolean;
  retrying: boolean;
  onRetry: (question: string) => void;
}

function TurnView({
  turn,
  isCurrent,
  status,
  error,
  events,
  since,
  refreshing,
  canRetry,
  retrying,
  onRetry,
}: TurnViewProps) {
  const question = turn.question?.content;
  const retry =
    canRetry && question ? (
      <Button variant="outline" size="sm" onClick={() => onRetry(question)} loading={retrying}>
        {retrying ? null : <RotateCw aria-hidden="true" />}
        Ask again
      </Button>
    ) : null;

  let outcome: React.ReactNode = null;
  if (turn.answer?.report_id) {
    outcome = <ReportMessage reportId={turn.answer.report_id} />;
  } else if (turn.answer) {
    outcome = (
      <p className="text-sm leading-6 wrap-break-word whitespace-pre-wrap">{turn.answer.content}</p>
    );
  } else if (!isCurrent) {
    outcome = (
      <p className="text-sm text-muted-foreground">No report was produced for this question.</p>
    );
  } else if (status === "failed") {
    outcome = (
      <div
        role="alert"
        className="flex flex-col gap-3 rounded-lg border border-border bg-destructive-soft p-4"
      >
        <div className="flex items-start gap-2.5 text-destructive-text">
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <div className="min-w-0 space-y-0.5 text-sm leading-6">
            <p className="font-medium">The analysis failed</p>
            <p className="wrap-break-word">{error || "No further detail was reported."}</p>
          </div>
        </div>
        {retry ? <div>{retry}</div> : null}
      </div>
    );
  } else if (status === "cancelled") {
    outcome = (
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Ban className="size-4" aria-hidden="true" />
          This analysis was cancelled before it produced a report.
        </p>
        {retry ? <div>{retry}</div> : null}
      </div>
    );
  } else if (status === "completed") {
    outcome = refreshing ? (
      <ReportSkeleton />
    ) : (
      <p className="text-sm text-muted-foreground">
        The analysis finished but no report was stored for it.
      </p>
    );
  }

  return (
    <section aria-label={`Question ${turn.turn}`} className="flex flex-col gap-4">
      {turn.question ? <QuestionBubble message={turn.question} /> : null}
      {isCurrent ? <ActivityTimeline events={events} status={status} since={since} /> : null}
      {outcome}
    </section>
  );
}

function WorkspaceSkeleton() {
  return (
    <PageContainer>
      <LoadingRegion label="Loading the analysis" className="space-y-6">
        <div className="space-y-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-7 w-2/3" />
          <Skeleton className="h-4 w-40" />
        </div>
        <Skeleton className="ml-auto h-16 w-2/3" />
        <ReportSkeleton />
      </LoadingRegion>
    </PageContainer>
  );
}

function describeMutationError(error: unknown): string {
  return errorMessage(error, "The question could not be sent. Please try again.");
}

function Conversation({ analysis }: { analysis: Analysis }) {
  const router = useRouter();
  const analysisQuery = useAnalysis(analysis.id);
  const eventsQuery = useAnalysisEvents(analysis.id);
  const followUp = useFollowUp(analysis.id);
  const cancel = useCancelAnalysis(analysis.id);
  const remove = useDeleteAnalysis();
  const suggestions = useDatasetSuggestions(analysis.dataset_id ?? undefined);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  // The polled events are the freshest view of the run; the detail query catches up after it ends.
  const polled = eventsQuery.data;
  const usePolled = polled !== undefined && polled.turn >= analysis.turn;
  const status: AnalysisStatus = usePolled ? polled.status : analysis.status;
  const currentTurn = usePolled ? polled.turn : analysis.turn;
  const runError = usePolled ? polled.error : analysis.error;
  const events = usePolled ? polled.events : [];
  const active = isActiveStatus(status);
  const turns = groupTurns(analysis.messages);
  const datasetGone = analysis.dataset_id === null;

  // The run has ended but the cached detail still says it is running: fetch the final messages.
  const detailStale = !active && isActiveStatus(analysis.status);
  const refetchAnalysis = analysisQuery.refetch;
  useEffect(() => {
    if (detailStale) void refetchAnalysis();
  }, [detailStale, refetchAnalysis]);

  useEffect(() => {
    // Bring a newly asked question into view.
    bottomRef.current?.scrollIntoView?.({ block: "end" });
  }, [currentTurn]);

  const ask = async (question: string) => {
    try {
      await followUp.mutateAsync(question);
    } catch (error) {
      toast.error(describeMutationError(error));
      throw error;
    }
  };

  const stop = () =>
    cancel.mutate(undefined, {
      onSuccess: () => toast.success("Cancellation requested"),
      onError: (error) => toast.error(errorMessage(error, "The analysis could not be cancelled.")),
    });

  const asked = new Set(turns.map((turn) => turn.question?.content.trim().toLowerCase()));
  const followUps = (suggestions.data?.questions ?? [])
    .filter((question) => !asked.has(question.trim().toLowerCase()))
    .slice(0, 3);

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <PageContainer className="flex-1 pb-4">
        <PageHeader
          back={{ href: "/app/analyses", label: "Analyses" }}
          title={analysis.title}
          description={
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <StatusBadge status={status} />
              {analysis.dataset_id ? (
                <Link
                  href={`/app/datasets/${analysis.dataset_id}`}
                  className="inline-flex items-center gap-1.5 rounded-sm underline-offset-4 hover:text-foreground hover:underline"
                >
                  <Database className="size-3.5" aria-hidden="true" />
                  {analysis.dataset_name}
                </Link>
              ) : (
                <span className="inline-flex items-center gap-1.5">
                  <Database className="size-3.5" aria-hidden="true" />
                  {analysis.dataset_name} (deleted)
                </span>
              )}
              <span>Started {formatDateTime(analysis.created_at)}</span>
            </span>
          }
          actions={
            <>
              {active ? (
                <Button variant="outline" size="sm" onClick={stop} loading={cancel.isPending}>
                  {cancel.isPending ? null : <Square aria-hidden="true" />}
                  Cancel analysis
                </Button>
              ) : null}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon-sm" aria-label="More actions">
                    <MoreHorizontal aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    destructive
                    disabled={active}
                    onSelect={() => setConfirmDelete(true)}
                  >
                    <Trash2 aria-hidden="true" />
                    {active ? "Cancel before deleting" : "Delete analysis"}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          }
        />

        <div className="flex flex-col gap-10">
          {turns.map((turn) => (
            <TurnView
              key={turn.turn}
              turn={turn}
              isCurrent={turn.turn === currentTurn}
              status={status}
              error={runError}
              events={events}
              since={analysis.started_at ?? turn.question?.created_at ?? analysis.created_at}
              refreshing={analysisQuery.isFetching || detailStale}
              canRetry={!datasetGone && !active}
              retrying={followUp.isPending}
              onRetry={(question) => void ask(question).catch(() => undefined)}
            />
          ))}
        </div>
        <div ref={bottomRef} aria-hidden="true" />
      </PageContainer>

      <div
        data-print="hide"
        className="sticky bottom-0 z-20 border-t border-border bg-background/95 backdrop-blur supports-backdrop-filter:bg-background/80"
      >
        <div className="mx-auto w-full max-w-6xl px-4 py-3 sm:px-6 lg:px-8">
          <QuestionComposer
            label="Ask a follow-up question"
            placeholder="Ask a follow-up about this dataset…"
            submitLabel="Ask"
            onSubmit={ask}
            pending={followUp.isPending}
            disabled={active || datasetGone}
            disabledReason={
              datasetGone
                ? "The dataset for this analysis was deleted, so it cannot be continued."
                : "You can ask a follow-up when this analysis finishes."
            }
            suggestions={active || datasetGone ? [] : followUps}
            suggestionsLabel="Suggested follow-ups"
            compactSuggestions
            rows={1}
          />
        </div>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this analysis?"
        description="The conversation and every report it produced will be permanently deleted. The dataset is kept."
        confirmLabel="Delete analysis"
        pending={remove.isPending}
        onConfirm={() =>
          remove.mutate(analysis.id, {
            onSuccess: () => {
              toast.success("Analysis deleted");
              router.push("/app/analyses");
            },
            onError: (error) => {
              toast.error(errorMessage(error, "The analysis could not be deleted."));
              setConfirmDelete(false);
            },
          })
        }
      />
    </div>
  );
}

/** The analysis workspace: the conversation, live progress, reports and the follow-up box. */
export function AnalysisWorkspace({ analysisId }: { analysisId: string }) {
  const analysis = useAnalysis(analysisId);

  if (analysis.isPending) return <WorkspaceSkeleton />;
  if (analysis.isError) {
    const notFound = analysis.error instanceof ApiError && analysis.error.status === 404;
    return (
      <PageContainer>
        <ErrorState
          error={analysis.error}
          title={notFound ? "Analysis not found" : "The analysis could not be loaded"}
          onRetry={notFound ? undefined : () => void analysis.refetch()}
          retrying={analysis.isFetching}
          action={
            <Button variant="outline" size="sm" asChild>
              <Link href="/app/analyses">Back to analyses</Link>
            </Button>
          }
        />
      </PageContainer>
    );
  }
  return <Conversation analysis={analysis.data} />;
}
