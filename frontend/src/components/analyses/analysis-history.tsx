"use client";

import { MessagesSquare, Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { PageContainer, PageHeader } from "@/components/common/page-header";
import { Pagination } from "@/components/common/pagination";
import { EmptyState, ErrorState } from "@/components/common/states";
import { Button } from "@/components/ui/button";
import { LoadingRegion, Skeleton } from "@/components/ui/skeleton";
import { useAnalyses } from "@/lib/query/hooks";
import { AnalysisList } from "./analysis-list";

const PAGE_SIZE = 20;

export function AnalysisHistory() {
  const [offset, setOffset] = useState(0);
  const analyses = useAnalyses({ limit: PAGE_SIZE, offset });

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
        <AnalysisList items={analyses.data.items} />
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
        description="Every question you have asked, newest first. Running analyses update here as they progress."
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
    </PageContainer>
  );
}
