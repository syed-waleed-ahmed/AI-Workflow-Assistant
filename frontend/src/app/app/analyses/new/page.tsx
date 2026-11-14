import type { Metadata } from "next";
import { Suspense } from "react";
import { NewAnalysis } from "@/components/analyses/new-analysis";
import { RouteFallback } from "@/components/common/route-fallback";
import { AppPage } from "@/components/layout/app-page";

export const metadata: Metadata = { title: "New analysis" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** The preselected dataset comes from the query string, which is only known at request time. */
async function Resolved({ searchParams }: { searchParams: SearchParams }) {
  const { dataset } = await searchParams;
  return (
    <AppPage label="Loading">
      <NewAnalysis initialDatasetId={(Array.isArray(dataset) ? dataset[0] : dataset) ?? null} />
    </AppPage>
  );
}

export default function NewAnalysisPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<RouteFallback label="Loading" />}>
      <Resolved searchParams={searchParams} />
    </Suspense>
  );
}
