"use client";

import { FileText, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { PageContainer, PageHeader } from "@/components/common/page-header";
import { Pagination } from "@/components/common/pagination";
import { EmptyState, ErrorState } from "@/components/common/states";
import { Button } from "@/components/ui/button";
import { LoadingRegion, Skeleton } from "@/components/ui/skeleton";
import { errorMessage } from "@/lib/api/client";
import type { ReportSummary } from "@/lib/api/types";
import { formatDateTime } from "@/lib/format";
import { useDeleteReport, useReports } from "@/lib/query/hooks";
import { ReportExportMenu } from "./report-export-menu";

const PAGE_SIZE = 20;

export function ReportLibrary() {
  const [offset, setOffset] = useState(0);
  const [deleting, setDeleting] = useState<ReportSummary | null>(null);
  const reports = useReports({ limit: PAGE_SIZE, offset });
  const remove = useDeleteReport();

  let body: React.ReactNode;
  if (reports.isPending) {
    body = (
      <LoadingRegion label="Loading reports" className="space-y-3">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-28 w-full" />
        ))}
      </LoadingRegion>
    );
  } else if (reports.isError) {
    body = (
      <ErrorState
        error={reports.error}
        title="Your reports could not be loaded"
        onRetry={() => void reports.refetch()}
        retrying={reports.isFetching}
      />
    );
  } else if (reports.data.total === 0) {
    body = (
      <EmptyState
        icon={FileText}
        title="No reports yet"
        description="A report is created each time an analysis finishes. Start an analysis to produce the first one."
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
        <ul className="space-y-3">
          {reports.data.items.map((report) => (
            <li key={report.id} className="rounded-lg border border-border bg-card p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 space-y-1">
                  <h2 className="text-sm font-semibold">
                    <Link
                      href={`/app/reports/${report.id}`}
                      className="rounded-sm wrap-break-word underline-offset-4 hover:underline"
                    >
                      {report.title}
                    </Link>
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    <span className="break-all">{report.dataset_name}</span> ·{" "}
                    {formatDateTime(report.created_at)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <ReportExportMenu reportId={report.id} />
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Delete report: ${report.title}`}
                    onClick={() => setDeleting(report)}
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                </div>
              </div>
              <p className="mt-2 line-clamp-2 max-w-3xl text-sm leading-6 wrap-break-word text-muted-foreground">
                {report.executive_summary}
              </p>
            </li>
          ))}
        </ul>
        <Pagination
          total={reports.data.total}
          limit={PAGE_SIZE}
          offset={offset}
          onOffsetChange={setOffset}
          noun="reports"
          disabled={reports.isFetching}
        />
      </div>
    );
  }

  return (
    <PageContainer>
      <PageHeader
        title="Reports"
        description="Every report your analyses have produced. Export them as Markdown, PDF or Excel."
      />
      {body}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => (open ? undefined : setDeleting(null))}
        title="Delete this report?"
        description={
          <>
            <span className="font-medium text-foreground">{deleting?.title}</span> will be
            permanently deleted. The dataset is kept.
          </>
        }
        confirmLabel="Delete report"
        pending={remove.isPending}
        onConfirm={() => {
          if (!deleting) return;
          remove.mutate(deleting.id, {
            onSuccess: () => {
              toast.success("Report deleted");
              setDeleting(null);
              if (reports.data && reports.data.items.length === 1 && offset > 0) {
                setOffset(Math.max(0, offset - PAGE_SIZE));
              }
            },
            onError: (error) => {
              toast.error(errorMessage(error, "The report could not be deleted."));
              setDeleting(null);
            },
          });
        }}
      />
    </PageContainer>
  );
}
