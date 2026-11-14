"use client";

import { ArrowRight, Database, FileSearch, MessagesSquare, Plus, Upload } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { AnalysisList } from "@/components/analyses/analysis-list";
import { QuestionComposer } from "@/components/analyses/question-composer";
import { StatusBadge } from "@/components/analyses/status-badge";
import { useStartAnalysis } from "@/components/analyses/use-start-analysis";
import { PageContainer } from "@/components/common/page-header";
import { EmptyState, ErrorState } from "@/components/common/states";
import { QualityBadge } from "@/components/datasets/badges";
import { DatasetUploader } from "@/components/datasets/dataset-uploader";
import { UploadDialog } from "@/components/datasets/upload-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LoadingRegion, Skeleton } from "@/components/ui/skeleton";
import type { AnalysisSummary, DatasetSummary } from "@/lib/api/types";
import { isActiveStatus } from "@/lib/api/types";
import { formatInteger } from "@/lib/format";
import {
  useAnalyses,
  useDatasets,
  useDatasetSuggestions,
  useMe,
  useUsage,
} from "@/lib/query/hooks";
import { UsageMeters } from "./usage-meters";

const ONBOARDING_STEPS = [
  {
    icon: Upload,
    title: "Upload a dataset",
    text: "CSV, TSV or Excel. It is validated, profiled and stored privately in your account.",
  },
  {
    icon: MessagesSquare,
    title: "Ask a question",
    text: "In plain language. The assistant plans the analysis and runs deterministic computations on your data.",
  },
  {
    icon: FileSearch,
    title: "Read a verified report",
    text: "Every figure is checked against the computed results and links to the calculation behind it.",
  },
] as const;

function Onboarding() {
  const router = useRouter();
  return (
    <section aria-labelledby="onboarding-title" className="space-y-6">
      <div className="space-y-1">
        <h2 id="onboarding-title" className="text-base font-semibold">
          Get started
        </h2>
        <p className="text-sm text-muted-foreground">
          You have no datasets yet. Upload one, or use the sample, to run your first analysis.
        </p>
      </div>
      <ol className="grid gap-3 md:grid-cols-3">
        {ONBOARDING_STEPS.map((step, index) => (
          <li key={step.title} className="flex gap-3 rounded-lg border border-border bg-card p-4">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
              <step.icon className="size-4" aria-hidden="true" />
            </span>
            <div className="space-y-1">
              <p className="text-sm font-semibold">
                <span className="tabular text-muted-foreground">{index + 1}.</span> {step.title}
              </p>
              <p className="text-sm leading-5 text-muted-foreground">{step.text}</p>
            </div>
          </li>
        ))}
      </ol>
      <DatasetUploader
        onUploaded={(dataset) => {
          toast.success(`Uploaded “${dataset.name}”`);
          router.push(`/app/analyses/new?dataset=${dataset.id}`);
        }}
      />
    </section>
  );
}

function QuickStart({
  datasets,
  limitReached,
}: {
  datasets: readonly DatasetSummary[];
  limitReached: boolean;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<string>(datasets[0]?.id ?? "");
  const [uploadOpen, setUploadOpen] = useState(false);
  const datasetId = datasets.some((dataset) => dataset.id === selected)
    ? selected
    : (datasets[0]?.id ?? "");
  const suggestions = useDatasetSuggestions(datasetId || undefined);
  const { start, pending } = useStartAnalysis();

  return (
    <Card>
      <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <CardTitle>Start an analysis</CardTitle>
          <CardDescription>Pick a dataset and ask a question about it.</CardDescription>
        </div>
        <Button variant="outline" size="sm" className="w-fit" onClick={() => setUploadOpen(true)}>
          <Plus aria-hidden="true" />
          Upload dataset
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex max-w-md flex-col gap-1.5">
          <Label htmlFor="quick-start-dataset">Dataset</Label>
          <NativeSelect
            id="quick-start-dataset"
            value={datasetId}
            onChange={(event) => setSelected(event.target.value)}
          >
            {datasets.map((dataset) => (
              <option key={dataset.id} value={dataset.id}>
                {dataset.name} ({formatInteger(dataset.row_count)} rows)
              </option>
            ))}
          </NativeSelect>
        </div>
        <QuestionComposer
          label="Question about the selected dataset"
          placeholder="For example: which regions are underperforming, and why?"
          onSubmit={(question) => start(datasetId, question)}
          pending={pending}
          disabled={limitReached || !datasetId}
          disabledReason="You have reached the analysis limit for the last 24 hours."
          suggestions={limitReached ? [] : (suggestions.data?.questions ?? []).slice(0, 3)}
        />
      </CardContent>
      <UploadDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        onUploaded={(dataset) => {
          toast.success(`Uploaded “${dataset.name}”`);
          router.push(`/app/datasets/${dataset.id}`);
        }}
      />
    </Card>
  );
}

function ActiveBanner({ analysis }: { analysis: AnalysisSummary }) {
  return (
    <Link
      href={`/app/analyses/${analysis.id}`}
      className="flex items-center gap-3 rounded-lg border border-border bg-accent-soft px-4 py-3 transition-colors hover:border-ring"
    >
      <StatusBadge status={analysis.status} />
      <span className="min-w-0 flex-1 truncate text-sm font-medium">{analysis.title}</span>
      <span className="hidden shrink-0 items-center gap-1 text-sm text-accent-text sm:flex">
        View progress
        <ArrowRight className="size-4" aria-hidden="true" />
      </span>
    </Link>
  );
}

function SectionHeading({
  title,
  href,
  linkLabel,
}: {
  title: string;
  href: string;
  linkLabel: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h2 className="text-sm font-semibold">{title}</h2>
      <Link
        href={href}
        className="inline-flex items-center gap-1 rounded-sm text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        {linkLabel}
        <ArrowRight className="size-3.5" aria-hidden="true" />
      </Link>
    </div>
  );
}

function DatasetPreviewList({ datasets }: { datasets: readonly DatasetSummary[] }) {
  return (
    <ul className="divide-y divide-border rounded-lg border border-border bg-card">
      {datasets.map((dataset) => (
        <li key={dataset.id}>
          <Link
            href={`/app/datasets/${dataset.id}`}
            className="flex items-center gap-3 px-4 py-3 transition-colors first:rounded-t-lg last:rounded-b-lg hover:bg-muted/60"
          >
            <Database className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{dataset.name}</p>
              <p className="tabular text-xs text-muted-foreground">
                {formatInteger(dataset.row_count)} rows × {formatInteger(dataset.column_count)}{" "}
                columns
              </p>
            </div>
            <QualityBadge score={dataset.quality_score} />
          </Link>
        </li>
      ))}
    </ul>
  );
}

function DashboardSkeleton() {
  return (
    <LoadingRegion label="Loading your dashboard" className="space-y-6">
      <Skeleton className="h-48 w-full" />
      <div className="grid gap-6 lg:grid-cols-2">
        <Skeleton className="h-56" />
        <Skeleton className="h-56" />
      </div>
    </LoadingRegion>
  );
}

/** The signed-in home: quick start, what is running, recent work and usage against limits. */
export function DashboardView() {
  const me = useMe();
  const usage = useUsage();
  const datasets = useDatasets({ limit: 5 });
  const analyses = useAnalyses({ limit: 5 });

  const firstName = me.data?.name.trim().split(/\s+/)[0];
  const loading = datasets.isPending || analyses.isPending;
  const failed = datasets.isError ? datasets : analyses.isError ? analyses : null;

  let body: React.ReactNode;
  if (loading) {
    body = <DashboardSkeleton />;
  } else if (failed) {
    body = (
      <ErrorState
        error={failed.error}
        title="Your dashboard could not be loaded"
        onRetry={() => {
          void datasets.refetch();
          void analyses.refetch();
        }}
        retrying={datasets.isFetching || analyses.isFetching}
      />
    );
  } else if (datasets.data && analyses.data) {
    const isNewUser = datasets.data.total === 0 && analyses.data.total === 0;
    const active = analyses.data.items.find((item) => isActiveStatus(item.status));
    const limitReached = usage.data
      ? usage.data.analyses_today >= usage.data.daily_analysis_limit
      : false;

    body = isNewUser ? (
      <Onboarding />
    ) : (
      <>
        {active ? <ActiveBanner analysis={active} /> : null}

        {datasets.data.total > 0 ? (
          <QuickStart datasets={datasets.data.items} limitReached={limitReached} />
        ) : (
          <EmptyState
            icon={Database}
            title="No datasets"
            description="Your earlier analyses are still here, but you need a dataset to start a new one."
            action={
              <Button size="sm" asChild>
                <Link href="/app/datasets">
                  <Plus aria-hidden="true" />
                  Upload a dataset
                </Link>
              </Button>
            }
          />
        )}

        <div className="grid gap-6 lg:grid-cols-2">
          <section className="space-y-3" aria-label="Recent analyses">
            <SectionHeading title="Recent analyses" href="/app/analyses" linkLabel="View all" />
            {analyses.data.items.length > 0 ? (
              <AnalysisList items={analyses.data.items} />
            ) : (
              <EmptyState
                icon={MessagesSquare}
                title="No analyses yet"
                description="Ask a question about one of your datasets to create the first one."
                className="py-8"
              />
            )}
          </section>
          <section className="space-y-3" aria-label="Datasets">
            <SectionHeading title="Datasets" href="/app/datasets" linkLabel="View all" />
            {datasets.data.items.length > 0 ? (
              <DatasetPreviewList datasets={datasets.data.items} />
            ) : (
              <EmptyState
                icon={Database}
                title="No datasets"
                description="Upload a file to see it here."
                className="py-8"
              />
            )}
          </section>
        </div>
      </>
    );
  }

  return (
    <PageContainer>
      <header className="space-y-1">
        <h1 className="text-xl leading-7 font-semibold tracking-tight">
          {firstName ? `Welcome, ${firstName}` : "Welcome"}
        </h1>
        <p className="text-sm text-muted-foreground">
          Ask questions of your data and get reports you can trace back to the computation.
        </p>
      </header>

      {body}

      <Card>
        <CardHeader>
          <CardTitle>Usage</CardTitle>
          <CardDescription>
            This app runs on free-tier infrastructure, so each account has limits. Analyses are
            counted over the last 24 hours.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <UsageMeters />
        </CardContent>
      </Card>
    </PageContainer>
  );
}
