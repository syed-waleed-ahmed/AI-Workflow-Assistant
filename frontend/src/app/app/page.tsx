import type { Metadata } from "next";
import { DashboardView } from "@/components/dashboard/dashboard-view";
import { AppPage } from "@/components/layout/app-page";

export const metadata: Metadata = { title: "Dashboard" };

export default function DashboardPage() {
  return (
    <AppPage label="Loading your dashboard">
      <DashboardView />
    </AppPage>
  );
}
