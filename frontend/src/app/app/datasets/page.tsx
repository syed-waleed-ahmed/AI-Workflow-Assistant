import type { Metadata } from "next";
import { DatasetLibrary } from "@/components/datasets/dataset-library";
import { AppPage } from "@/components/layout/app-page";

export const metadata: Metadata = { title: "Datasets" };

export default function DatasetsPage() {
  return (
    <AppPage label="Loading datasets">
      <DatasetLibrary />
    </AppPage>
  );
}
