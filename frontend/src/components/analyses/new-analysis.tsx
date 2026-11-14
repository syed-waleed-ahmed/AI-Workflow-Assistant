"use client";

import { Database } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { PageContainer, PageHeader } from "@/components/common/page-header";
import { EmptyState, ErrorState, InlineError } from "@/components/common/states";
import { QualityBadge } from "@/components/datasets/badges";
import { DatasetUploader } from "@/components/datasets/dataset-uploader";
import { Card, CardContent } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoadingRegion, Skeleton } from "@/components/ui/skeleton";
import { formatInteger } from "@/lib/format";
import { useDatasets, useDatasetSuggestions, useUsage } from "@/lib/query/hooks";
import { QuestionComposer } from "./question-composer";
import { useStartAnalysis } from "./use-start-analysis";

/** Choose a dataset, then ask the first question of a new analysis. */
export function NewAnalysis({ initialDatasetId }: { initialDatasetId?: string | null }) {
  const router = useRouter();
  const datasets = useDatasets({ limit: 100 });
  const usage = useUsage();
  const [selected, setSelected] = useState<string | null>(initialDatasetId ?? null);
  const { start, pending } = useStartAnalysis();

  const items = datasets.data?.items ?? [];
  const dataset = items.find((item) => item.id === selected) ?? items[0];
  const suggestions = useDatasetSuggestions(dataset?.id);
  const limitReached = usage.data
    ? usage.data.analyses_today >= usage.data.daily_analysis_limit
    : false;
  const requestedMissing =
    Boolean(initialDatasetId) &&
    datasets.isSuccess &&
    !items.some((item) => item.id === initialDatasetId);

  let body: React.ReactNode;
  if (datasets.isPending) {
    body = (
      <LoadingRegion label="Loading datasets" className="space-y-4">
        <Skeleton className="h-9 w-full max-w-md" />
        <Skeleton className="h-28 w-full" />
      </LoadingRegion>
    );
  } else if (datasets.isError) {
    body = (
      <ErrorState
        error={datasets.error}
        title="Your datasets could not be loaded"
        onRetry={() => void datasets.refetch()}
        retrying={datasets.isFetching}
      />
    );
  } else if (!dataset) {
    body = (
      <div className="space-y-4">
        <EmptyState
          icon={Database}
          title="Upload a dataset first"
          description="An analysis needs a dataset to work on. Upload a file below or try the sample dataset."
        />
        <DatasetUploader
          onUploaded={(uploaded) => {
            toast.success(`Uploaded “${uploaded.name}”`);
            setSelected(uploaded.id);
            router.replace(`/app/analyses/new?dataset=${uploaded.id}`);
          }}
        />
      </div>
    );
  } else {
    body = (
      <Card>
        <CardContent className="space-y-5 p-4 sm:p-5">
          {requestedMissing ? (
            <InlineError>
              The dataset in the link was not found. Another dataset is selected instead.
            </InlineError>
          ) : null}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="analysis-dataset">Dataset</Label>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <NativeSelect
                id="analysis-dataset"
                className="sm:max-w-md"
                value={dataset.id}
                onChange={(event) => setSelected(event.target.value)}
              >
                {items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </NativeSelect>
              <p className="tabular flex items-center gap-2 text-sm text-muted-foreground">
                {formatInteger(dataset.row_count)} rows × {formatInteger(dataset.column_count)}{" "}
                columns
                <QualityBadge score={dataset.quality_score} />
                <Link
                  href={`/app/datasets/${dataset.id}`}
                  className="font-medium text-accent-text underline-offset-4 hover:underline"
                >
                  View
                </Link>
              </p>
            </div>
          </div>

          {limitReached ? (
            <InlineError>
              You have used all {usage.data?.daily_analysis_limit} analyses available in a 24-hour
              period. Please try again later.
            </InlineError>
          ) : null}

          <QuestionComposer
            label="Your question"
            placeholder="What would you like to know about this dataset?"
            submitLabel="Start analysis"
            rows={3}
            autoFocus
            onSubmit={(question) => start(dataset.id, question)}
            pending={pending}
            disabled={limitReached}
            disabledReason="The analysis limit for the last 24 hours has been reached."
            suggestions={limitReached ? [] : (suggestions.data?.questions ?? [])}
          />

          <p className="text-xs leading-5 text-muted-foreground">
            An analysis usually takes 40–120 seconds. Column names, summary statistics and
            aggregated results are sent to the AI model to plan the work and write the report; the
            numbers themselves are computed from your data by deterministic tools.
            {usage.data
              ? ` You have used ${usage.data.analyses_today} of ${usage.data.daily_analysis_limit} analyses in the last 24 hours.`
              : ""}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <PageContainer className="max-w-4xl">
      <PageHeader
        back={{ href: "/app/analyses", label: "Analyses" }}
        title="New analysis"
        description="Ask a question in plain language. You can ask follow-up questions once the first report is ready."
      />
      {body}
    </PageContainer>
  );
}
