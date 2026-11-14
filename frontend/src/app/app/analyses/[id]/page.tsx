import type { Metadata } from "next";
import { Suspense } from "react";
import { RouteFallback } from "@/components/common/route-fallback";
import { AnalysisWorkspace } from "@/components/analyses/analysis-workspace";
import { AppPage } from "@/components/layout/app-page";

export const metadata: Metadata = { title: "Analysis" };

type Params = Promise<{ id: string }>;

/** The id is only known at request time; the shell around it is prerendered. */
async function Resolved({ params }: { params: Params }) {
  const { id } = await params;
  return (
    <AppPage label="Loading the analysis">
      <AnalysisWorkspace analysisId={id} />
    </AppPage>
  );
}

export default function Page({ params }: { params: Params }) {
  return (
    <Suspense fallback={<RouteFallback label="Loading the analysis" />}>
      <Resolved params={params} />
    </Suspense>
  );
}
