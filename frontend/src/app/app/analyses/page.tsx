import type { Metadata } from "next";
import { AnalysisHistory } from "@/components/analyses/analysis-history";
import { AppPage } from "@/components/layout/app-page";

export const metadata: Metadata = { title: "Analyses" };

export default function AnalysesPage() {
  return (
    <AppPage label="Loading analyses">
      <AnalysisHistory />
    </AppPage>
  );
}
