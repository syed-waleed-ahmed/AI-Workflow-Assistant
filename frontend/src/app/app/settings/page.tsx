import type { Metadata } from "next";
import { SettingsView } from "@/components/settings/settings-view";
import { AppPage } from "@/components/layout/app-page";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <AppPage label="Loading settings">
      <SettingsView />
    </AppPage>
  );
}
