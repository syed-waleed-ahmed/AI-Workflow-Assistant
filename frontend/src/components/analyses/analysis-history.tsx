"use client";

import { MessagesSquare, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { PageContainer, PageHeader } from "@/components/common/page-header";
import { Pagination } from "@/components/common/pagination";
import { EmptyState, ErrorState } from "@/components/common/states";
import { ReportExportMenu } from "@/components/reports/report-export-menu";
import { Button } from "@/components/ui/button";
import { LoadingRegion, Skeleton } from "@/components/ui/skeleton";
import { errorMessage } from "@/lib/api/client";
import type { AnalysisSummary } from "@/lib/api/types";
import { isActiveStatus } from "@/lib/api/types";
import { useAnalyses, useDeleteAnalysis } from "@/lib/query/hooks";
import { AnalysisList } from "./analysis-list";

const PAGE_SIZE = 20;

/** Every conversation, with its latest report one click from export. */
export function AnalysisHistory() {
  const [offset, setOffset] = useState(0);
  const [deleting, setDeleting] = useState<AnalysisSummary | null>(null);
  const analyses = useAnalyses({ limit: PAGE_SIZE, offset });
  const remove = useDeleteAnalysis();

  let body: React.ReactNode;
  if (analyses.isPending) {
    body = (
      <LoadingRegion label="Loading analyses" className="space-y-2">
        {Array.from({ length: 5 }, (_, index) => (
          <Skeleton key={index} className="h-16 w-full" />
        ))}
      </LoadingRegion>
    );
  } else if (analyses.isError) {
    body = (
      <ErrorState
        error={analyses.error}
        title="Your analyses could not be loaded"
        onRetry={() => void analyses.refetch()}
        retrying={analyses.isFetching}
      />
    );
  } else if (analyses.data.total === 0) {
    body = (
      <EmptyState
        icon={MessagesSquare}
        title="No analyses yet"
        description="An analysis is a conversation about one dataset: your question, the computations that were run, and the report they produced."
        action={
          <Button size="sm" asChild>
            <Link href="/app/analyses/new">
              <Plus aria-hidden="true" />
              New analysis
            </Link>
          </Button>
        }
      />
    );
  } else {
    body = (
      <div className="space-y-3">
        <AnalysisList
          items={analyses.data.items}
          renderActions={(analysis) => (
            <>
              {analysis.latest_report_id ? (
                <ReportExportMenu
                  reportId={analysis.latest_report_id}
                  iconOnly
                  reportLabel={analysis.title}
                />
              ) : null}
              {isActiveStatus(analysis.status) ? null : (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Delete analysis: ${analysis.title}`}
                  className="text-muted-foreground hover:bg-destructive-soft hover:text-destructive-text"
                  onClick={() => setDeleting(analysis)}
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              )}
            </>
          )}
        />
        <Pagination
          total={analyses.data.total}
          limit={PAGE_SIZE}
          offset={offset}
          onOffsetChange={setOffset}
          noun="analyses"
          disabled={analyses.isFetching}
        />
      </div>
    );
  }

  return (
    <PageContainer>
      <PageHeader
        title="Analyses"
        description="Every question you have asked, newest first. Open one to continue the conversation, or export its latest report as Markdown, PDF or Excel."
        actions={
          <Button size="sm" asChild>
            <Link href="/app/analyses/new">
              <Plus aria-hidden="true" />
              New analysis
            </Link>
          </Button>
        }
      />
      {body}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => (open ? undefined : setDeleting(null))}
        title="Delete this analysis?"
        description={
          <>
            <span className="font-medium text-foreground">{deleting?.title}</span> and every report
            it produced will be permanently deleted. The dataset is kept.
          </>
        }
        confirmLabel="Delete analysis"
        pending={remove.isPending}
        onConfirm={() => {
          if (!deleting) return;
          remove.mutate(deleting.id, {
            onSuccess: () => {
              toast.success("Analysis deleted");
              setDeleting(null);
              if (analyses.data && analyses.data.items.length === 1 && offset > 0) {
                setOffset(Math.max(0, offset - PAGE_SIZE));
              }
            },
            onError: (error) => {
              toast.error(errorMessage(error, "The analysis could not be deleted."));
              setDeleting(null);
            },
          });
        }}
      />
    </PageContainer>
  );
}
