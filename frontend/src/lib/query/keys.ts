import type { PageParams } from "@/lib/api/endpoints";

export const queryKeys = {
  me: ["me"] as const,
  usage: ["usage"] as const,
  datasetsAll: ["datasets"] as const,
  datasets: (params: PageParams) => ["datasets", "list", params] as const,
  dataset: (id: string) => ["datasets", "detail", id] as const,
  datasetPreview: (id: string, params: PageParams) => ["datasets", "preview", id, params] as const,
  datasetSuggestions: (id: string) => ["datasets", "suggestions", id] as const,
  analysesAll: ["analyses"] as const,
  analysesLists: ["analyses", "list"] as const,
  analyses: (params: PageParams & { dataset_id?: string }) => ["analyses", "list", params] as const,
  analysis: (id: string) => ["analyses", "detail", id] as const,
  analysisEvents: (id: string) => ["analyses", "events", id] as const,
  reportsAll: ["reports"] as const,
  reportsLists: ["reports", "list"] as const,
  reports: (params: PageParams) => ["reports", "list", params] as const,
  report: (id: string) => ["reports", "detail", id] as const,
};
