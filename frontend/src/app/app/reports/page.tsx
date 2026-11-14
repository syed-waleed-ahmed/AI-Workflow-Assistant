import type { Metadata } from "next";
import { ReportLibrary } from "@/components/reports/report-library";
import { AppPage } from "@/components/layout/app-page";

export const metadata: Metadata = { title: "Reports" };

export default function ReportsPage() {
  return (
    <AppPage label="Loading reports">
      <ReportLibrary />
    </AppPage>
  );
}
