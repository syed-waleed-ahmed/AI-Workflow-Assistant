import sampleReportJson from "@/data/sample-report.json";
import type {
  Analysis,
  AnalysisEvent,
  AnalysisSummary,
  Chart,
  Dataset,
  DatasetSummary,
  Report,
  ReportContent,
  Usage,
  User,
} from "@/lib/api/types";

/** The real report the backend produced for data/sample_sales.csv. */
export const sampleReport = sampleReportJson as unknown as ReportContent;

export function sampleChart(evidenceId: string): Chart {
  const visualization = sampleReport.visualizations.find((item) => item.evidence_id === evidenceId);
  if (!visualization) throw new Error(`No chart for ${evidenceId} in the sample report`);
  return visualization.chart;
}

export const user: User = {
  id: "0b0e3a52-6f0f-4f39-9d4f-2f1c0a6f7e11",
  email: "ada@example.com",
  name: "Ada Lovelace",
  created_at: "2026-11-01T09:00:00Z",
};

export const usage: Usage = {
  analyses_today: 3,
  daily_analysis_limit: 10,
  analyses_total: 12,
  datasets: 2,
  max_datasets: 25,
  storage_used_bytes: 5 * 1024 * 1024,
  storage_quota_bytes: 100 * 1024 * 1024,
  reports: 4,
  max_upload_bytes: 20 * 1024 * 1024,
  max_rows: 250_000,
  max_columns: 200,
};

export const datasetSummary: DatasetSummary = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "sample_sales.csv",
  original_filename: "sample_sales.csv",
  file_format: "csv",
  sheet_name: null,
  original_size_bytes: 157_000,
  stored_size_bytes: 48_000,
  row_count: 2400,
  column_count: 11,
  quality_score: 97,
  created_at: "2026-11-13T10:00:00Z",
};

export const dataset: Dataset = {
  ...datasetSummary,
  profile: {
    row_count: 2400,
    column_count: 11,
    memory_bytes: 900_000,
    duplicate_rows: 0,
    kind_counts: { identifier: 2, datetime: 1, categorical: 4, numeric: 4 },
    columns: [
      {
        name: "region",
        dtype: "object",
        kind: "categorical",
        non_null: 2400,
        missing: 0,
        missing_pct: 0,
        unique: 4,
        sample_values: ["Europe", "North America"],
        stats: null,
        top_values: [
          { value: "North America", count: 972 },
          { value: "Europe", count: 688 },
        ],
      },
      {
        name: "unit_price",
        dtype: "float64",
        kind: "numeric",
        non_null: 2330,
        missing: 70,
        missing_pct: 2.92,
        unique: 2100,
        sample_values: [260.47, 248.54],
        stats: { min: 80.1, max: 419.9, mean: 250.1 },
        top_values: null,
      },
    ],
    quality: {
      score: 97,
      missing_cells: 70,
      missing_cells_pct: 0.27,
      issues: [{ severity: "low", column: "unit_price", message: "2.92% of values are missing." }],
    },
    ingest_notes: [],
  },
};

export function analysisSummary(overrides: Partial<AnalysisSummary> = {}): AnalysisSummary {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    dataset_id: datasetSummary.id,
    dataset_name: datasetSummary.name,
    title: "Which regions are underperforming?",
    status: "completed",
    turn: 1,
    error: null,
    created_at: "2026-11-13T11:00:00Z",
    started_at: "2026-11-13T11:00:02Z",
    finished_at: "2026-11-13T11:01:10Z",
    ...overrides,
  };
}

export const REPORT_ID = "33333333-3333-4333-8333-333333333333";

export function analysis(overrides: Partial<Analysis> = {}): Analysis {
  const summary = analysisSummary(overrides);
  return {
    ...summary,
    messages: [
      {
        id: "44444444-4444-4444-8444-444444444441",
        turn: 1,
        role: "user",
        content: summary.title,
        report_id: null,
        created_at: summary.created_at,
      },
      {
        id: "44444444-4444-4444-8444-444444444442",
        turn: 1,
        role: "assistant",
        content: sampleReport.executive_summary,
        report_id: REPORT_ID,
        created_at: "2026-11-13T11:01:10Z",
      },
    ],
    ...overrides,
  };
}

export const report: Report = {
  id: REPORT_ID,
  analysis_id: "22222222-2222-4222-8222-222222222222",
  turn: 1,
  title: sampleReport.title,
  dataset_name: sampleReport.dataset_overview.name,
  question: sampleReport.question,
  executive_summary: sampleReport.executive_summary,
  created_at: "2026-11-13T11:01:10Z",
  content: sampleReport,
};

let eventId = 0;

export function resetEventIds(): void {
  eventId = 0;
}

/** Builds a progress event the way the backend emits them. */
export function event(
  kind: string,
  label: string,
  detail: AnalysisEvent["detail"] = null,
  turn = 1,
): AnalysisEvent {
  eventId += 1;
  return { id: eventId, turn, kind, label, detail, created_at: "2026-11-13T11:00:05Z" };
}

/* Small charts in the shapes the backend tools produce (backend/app/tools). */

export const histogramChart: Chart = {
  type: "histogram",
  title: "Distribution of revenue",
  x_key: "bin",
  x_label: "revenue",
  y_label: "Rows",
  series: [{ key: "count", label: "Rows" }],
  data: [
    { bin: "0 – 2,000", count: 310 },
    { bin: "2,000 – 4,000", count: 820 },
    { bin: "4,000 – 6,000", count: 760 },
    { bin: "6,000 – 8,000", count: 510 },
  ],
};

export const pieChart: Chart = {
  type: "pie",
  title: "Rows by channel",
  x_key: "channel",
  x_label: "channel",
  y_label: "Rows",
  series: [{ key: "count", label: "Rows" }],
  data: [
    { channel: "Online", count: 1100 },
    { channel: "Retail", count: 800 },
    { channel: "Partner", count: 500 },
  ],
};

export const scatterChart: Chart = {
  type: "scatter",
  title: "revenue vs units",
  x_key: "units",
  x_label: "units",
  y_label: "revenue",
  series: [],
  data: [
    { units: 8, revenue: 1684.94 },
    { units: 21, revenue: 5219.34 },
    { units: 24, revenue: 4620.48 },
    { units: 31, revenue: 7267.11 },
    { units: 12, revenue: 2950 },
  ],
};

export const heatmapChart: Chart = {
  type: "heatmap",
  title: "Pearson correlation matrix",
  x_key: "x",
  x_label: "",
  y_label: "",
  series: [],
  data: [
    { x: "units", y: "units", value: 1 },
    { x: "revenue", y: "units", value: 0.82 },
    { x: "discount_pct", y: "units", value: -0.45 },
    { x: "units", y: "revenue", value: 0.82 },
    { x: "revenue", y: "revenue", value: 1 },
    { x: "discount_pct", y: "revenue", value: -0.12 },
    { x: "units", y: "discount_pct", value: -0.45 },
    { x: "revenue", y: "discount_pct", value: -0.12 },
    { x: "discount_pct", y: "discount_pct", value: 1 },
  ],
};
