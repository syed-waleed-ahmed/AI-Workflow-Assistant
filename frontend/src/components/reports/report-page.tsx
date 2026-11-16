"use client";

import { ChevronLeft, MessagesSquare, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { PageContainer } from "@/components/common/page-header";
import { ErrorState } from "@/components/common/states";
import { Button } from "@/components/ui/button";
import { LoadingRegion, Skeleton } from "@/components/ui/skeleton";
import { ApiError, errorMessage } from "@/lib/api/client";
import { downloadReportExport } from "@/lib/api/download";
import { useDeleteReport, useReport } from "@/lib/query/hooks";
import { ReportExportMenu } from "./report-export-menu";
import { ReportView } from "./report-view";

/** A stored report on its own page, with exports and print-friendly output. */
export function ReportPage({ reportId }: { reportId: string }) {
  const router = useRouter();
  const report = useReport(reportId);
  const remove = useDeleteReport();
  const [deleteOpen, setDeleteOpen] = useState(false);

  if (report.isPending) {
    return (
      <PageContainer>
        <LoadingRegion label="Loading the report" className="space-y-5">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-24 w-full" />
          <div className="grid gap-3 sm:grid-cols-3">
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
          </div>
          <Skeleton className="h-64 w-full" />
        </LoadingRegion>
      </PageContainer>
    );
  }

  if (report.isError) {
    const notFound = report.error instanceof ApiError && report.error.status === 404;
    return (
      <PageContainer>
        <ErrorState
          error={report.error}
          title={notFound ? "Report not found" : "The report could not be loaded"}
          onRetry={notFound ? undefined : () => void report.refetch()}
          retrying={report.isFetching}
          action={
            <Button variant="outline" size="sm" asChild>
              <Link href="/app/analyses">Back to analyses</Link>
            </Button>
          }
        />
      </PageContainer>
    );
  }

  const data = report.data;
  const conversation = `/app/analyses/${data.analysis_id}`;
  return (
    <PageContainer>
      <Link
        href={conversation}
        data-print="hide"
        className="inline-flex w-fit items-center gap-1 rounded-sm text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronLeft className="size-4" aria-hidden="true" />
        Back to the analysis
      </Link>

      <ReportView
        report={data.content}
        headingLevel={1}
        onDownloadTable={(evidenceId) => downloadReportExport(data.id, "csv", evidenceId)}
        actions={
          <>
            <Button variant="outline" size="sm" asChild>
              <Link href={conversation}>
                <MessagesSquare aria-hidden="true" />
                Conversation
              </Link>
            </Button>
            <ReportExportMenu reportId={data.id} allowPrint />
            <Button
              variant="destructive-outline"
              size="icon-sm"
              aria-label="Delete report"
              onClick={() => setDeleteOpen(true)}
            >
              <Trash2 aria-hidden="true" />
            </Button>
          </>
        }
      />

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete this report?"
        description="The report will be permanently deleted. The dataset is kept."
        confirmLabel="Delete report"
        pending={remove.isPending}
        onConfirm={() =>
          remove.mutate(data.id, {
            onSuccess: () => {
              toast.success("Report deleted");
              router.push(conversation);
            },
            onError: (error) => {
              toast.error(errorMessage(error, "The report could not be deleted."));
              setDeleteOpen(false);
            },
          })
        }
      />
    </PageContainer>
  );
}
