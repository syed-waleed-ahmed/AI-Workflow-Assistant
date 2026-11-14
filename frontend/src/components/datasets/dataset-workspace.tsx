"use client";

import { CircleCheck, Info, Pencil, Sparkles, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { AnalysisList } from "@/components/analyses/analysis-list";
import { useStartAnalysis } from "@/components/analyses/use-start-analysis";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { PageContainer, PageHeader } from "@/components/common/page-header";
import { ErrorState } from "@/components/common/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LoadingRegion, Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ApiError, errorMessage } from "@/lib/api/client";
import type { Dataset } from "@/lib/api/types";
import {
  formatBytes,
  formatDate,
  formatDateTime,
  formatInteger,
  formatPercent,
} from "@/lib/format";
import {
  useAnalyses,
  useDataset,
  useDatasetSuggestions,
  useDeleteDataset,
} from "@/lib/query/hooks";
import { kindLabel, QualityBadge, SeverityBadge } from "./badges";
import { ColumnProfiles } from "./column-profiles";
import { DataPreview } from "./data-preview";
import { RenameDatasetDialog } from "./rename-dialog";

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0 space-y-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="tabular truncate text-sm font-medium">{value}</dd>
    </div>
  );
}

function QualityCard({ dataset }: { dataset: Dataset }) {
  const {
    quality,
    ingest_notes: ingestNotes = [],
    duplicate_rows: duplicateRows,
  } = dataset.profile;
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3">
        <CardTitle>Data quality</CardTitle>
        <QualityBadge score={quality.score} />
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="grid grid-cols-2 gap-4">
          <Fact
            label="Missing cells"
            value={`${formatPercent(quality.missing_cells_pct, 2)} (${formatInteger(quality.missing_cells)})`}
          />
          <Fact label="Duplicate rows" value={formatInteger(duplicateRows)} />
        </dl>
        {quality.issues.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <CircleCheck className="size-4 text-success-text" aria-hidden="true" />
            No quality issues were detected.
          </p>
        ) : (
          <ul className="space-y-2" aria-label="Quality issues">
            {quality.issues.map((issue, index) => (
              <li key={index} className="flex items-start gap-2 text-sm leading-5">
                <SeverityBadge severity={issue.severity} />
                <span className="min-w-0 wrap-break-word">
                  {issue.column ? <span className="font-medium">{issue.column}: </span> : null}
                  <span className="text-muted-foreground">{issue.message}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
        {ingestNotes.length > 0 ? (
          <div className="space-y-1.5 border-t border-border pt-3">
            <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Info className="size-3.5" aria-hidden="true" />
              Import notes
            </p>
            <ul className="list-disc space-y-1 pl-5 text-sm leading-5 text-muted-foreground">
              {ingestNotes.map((note, index) => (
                <li key={index} className="wrap-break-word">
                  {note}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function SuggestedQuestions({ datasetId }: { datasetId: string }) {
  const suggestions = useDatasetSuggestions(datasetId);
  const { start, pending } = useStartAnalysis();
  const [started, setStarted] = useState<string | null>(null);

  let body: React.ReactNode;
  if (suggestions.isPending) {
    body = (
      <LoadingRegion label="Loading suggested questions" className="space-y-2">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-5/6" />
        <Skeleton className="h-9 w-4/6" />
      </LoadingRegion>
    );
  } else if (suggestions.isError) {
    body = (
      <p className="text-sm text-muted-foreground">
        Suggestions could not be loaded.{" "}
        <Button variant="link" onClick={() => void suggestions.refetch()}>
          Try again
        </Button>
      </p>
    );
  } else if (suggestions.data.questions.length === 0) {
    body = (
      <p className="text-sm text-muted-foreground">
        No suggestions for this dataset. Ask your own question.
      </p>
    );
  } else {
    body = (
      <ul className="space-y-2">
        {suggestions.data.questions.map((question) => (
          <li key={question}>
            <Button
              variant="outline"
              className="h-auto w-full justify-start py-2 text-left leading-5 font-normal whitespace-normal"
              disabled={pending}
              loading={pending && started === question}
              onClick={() => {
                setStarted(question);
                void start(datasetId, question).catch(() => undefined);
              }}
            >
              {pending && started === question ? null : (
                <Sparkles className="text-muted-foreground" aria-hidden="true" />
              )}
              <span className="min-w-0 wrap-break-word">{question}</span>
            </Button>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Suggested questions</CardTitle>
        <p className="text-sm leading-5 text-muted-foreground">
          Generated from this dataset&apos;s columns. Selecting one starts an analysis.
        </p>
      </CardHeader>
      <CardContent>{body}</CardContent>
    </Card>
  );
}

function DatasetAnalyses({ datasetId }: { datasetId: string }) {
  const analyses = useAnalyses({ dataset_id: datasetId, limit: 20 });
  if (analyses.isPending) {
    return (
      <LoadingRegion label="Loading analyses" className="space-y-2">
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
      </LoadingRegion>
    );
  }
  if (analyses.isError) {
    return (
      <ErrorState
        error={analyses.error}
        title="Analyses could not be loaded"
        onRetry={() => void analyses.refetch()}
        retrying={analyses.isFetching}
      />
    );
  }
  if (analyses.data.total === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No analyses of this dataset yet.{" "}
        <Link
          href={`/app/analyses/new?dataset=${datasetId}`}
          className="font-medium text-accent-text underline-offset-4 hover:underline"
        >
          Ask the first question
        </Link>
        .
      </p>
    );
  }
  return <AnalysisList items={analyses.data.items} showDataset={false} />;
}

function WorkspaceSkeleton() {
  return (
    <PageContainer>
      <LoadingRegion label="Loading the dataset" className="space-y-6">
        <div className="space-y-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-7 w-1/2" />
        </div>
        <Skeleton className="h-20 w-full" />
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-56" />
          <Skeleton className="h-56" />
        </div>
        <Skeleton className="h-64 w-full" />
      </LoadingRegion>
    </PageContainer>
  );
}

/** Everything about one dataset: file facts, quality, column profiles, a data preview and actions. */
export function DatasetWorkspace({ datasetId }: { datasetId: string }) {
  const router = useRouter();
  const dataset = useDataset(datasetId);
  const remove = useDeleteDataset();
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  if (dataset.isPending) return <WorkspaceSkeleton />;
  if (dataset.isError) {
    const notFound = dataset.error instanceof ApiError && dataset.error.status === 404;
    return (
      <PageContainer>
        <ErrorState
          error={dataset.error}
          title={notFound ? "Dataset not found" : "The dataset could not be loaded"}
          onRetry={notFound ? undefined : () => void dataset.refetch()}
          retrying={dataset.isFetching}
          action={
            <Button variant="outline" size="sm" asChild>
              <Link href="/app/datasets">Back to datasets</Link>
            </Button>
          }
        />
      </PageContainer>
    );
  }

  const data = dataset.data;
  const profile = data.profile;
  const kinds = Object.entries(profile.kind_counts).filter(([, count]) => count > 0);

  return (
    <PageContainer>
      <PageHeader
        back={{ href: "/app/datasets", label: "Datasets" }}
        title={data.name}
        description={
          <span className="break-all">
            {data.original_filename}
            {data.sheet_name ? ` · sheet “${data.sheet_name}”` : ""}
          </span>
        }
        actions={
          <>
            <Button size="sm" asChild>
              <Link href={`/app/analyses/new?dataset=${data.id}`}>
                <Sparkles aria-hidden="true" />
                Analyse
              </Link>
            </Button>
            <Button variant="outline" size="sm" onClick={() => setRenameOpen(true)}>
              <Pencil aria-hidden="true" />
              Rename
            </Button>
            <Button variant="destructive-outline" size="sm" onClick={() => setDeleteOpen(true)}>
              <Trash2 aria-hidden="true" />
              Delete
            </Button>
          </>
        }
      />

      <Card>
        <CardContent className="space-y-4 p-4 sm:p-5">
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            <Fact label="Rows" value={formatInteger(data.row_count)} />
            <Fact label="Columns" value={formatInteger(data.column_count)} />
            <Fact label="File size" value={formatBytes(data.original_size_bytes)} />
            <Fact label="Stored size" value={formatBytes(data.stored_size_bytes)} />
            <Fact label="Format" value={data.file_format.toUpperCase()} />
            <Fact
              label="Uploaded"
              value={
                <span title={formatDateTime(data.created_at)}>{formatDate(data.created_at)}</span>
              }
            />
          </dl>
          {kinds.length > 0 ? (
            <ul
              className="flex flex-wrap gap-1.5 border-t border-border pt-4"
              aria-label="Column kinds"
            >
              {kinds.map(([kind, count]) => (
                <li key={kind}>
                  <Badge tone="outline" className="tabular">
                    {count} {kindLabel(kind).toLowerCase()}
                  </Badge>
                </li>
              ))}
            </ul>
          ) : null}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <QualityCard dataset={data} />
        <SuggestedQuestions datasetId={data.id} />
      </div>

      <Tabs defaultValue="columns">
        <TabsList aria-label="Dataset details">
          <TabsTrigger value="columns">
            Columns
            <span className="tabular text-xs font-normal text-muted-foreground">
              {profile.columns.length}
            </span>
          </TabsTrigger>
          <TabsTrigger value="preview">Data preview</TabsTrigger>
          <TabsTrigger value="analyses">Analyses</TabsTrigger>
        </TabsList>
        <TabsContent value="columns">
          <h2 className="sr-only">Columns</h2>
          <ColumnProfiles columns={profile.columns} rowCount={profile.row_count} />
        </TabsContent>
        <TabsContent value="preview">
          <h2 className="sr-only">Data preview</h2>
          <DataPreview datasetId={data.id} />
        </TabsContent>
        <TabsContent value="analyses">
          <h2 className="sr-only">Analyses of this dataset</h2>
          <DatasetAnalyses datasetId={data.id} />
        </TabsContent>
      </Tabs>

      <RenameDatasetDialog dataset={data} open={renameOpen} onOpenChange={setRenameOpen} />
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={`Delete “${data.name}”?`}
        description="The stored file and its profile will be permanently deleted. Existing analyses and reports are kept, but you will not be able to ask follow-up questions on them."
        confirmLabel="Delete dataset"
        pending={remove.isPending}
        onConfirm={() =>
          remove.mutate(data.id, {
            onSuccess: () => {
              toast.success(`Deleted “${data.name}”`);
              router.push("/app/datasets");
            },
            onError: (error) => {
              toast.error(errorMessage(error, "The dataset could not be deleted."));
              setDeleteOpen(false);
            },
          })
        }
      />
    </PageContainer>
  );
}
