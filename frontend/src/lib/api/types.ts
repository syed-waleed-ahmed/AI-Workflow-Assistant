import type { components } from "./schema";

type Schemas = components["schemas"];

export type User = Schemas["UserOut"];
export type Usage = Schemas["UsageOut"];

export type DatasetSummary = Schemas["DatasetSummary"];
export type Dataset = Schemas["DatasetOut"];
export type DatasetList = Schemas["DatasetList"];
export type DatasetProfile = Schemas["DatasetProfile"];
export type ColumnProfile = Schemas["ColumnProfile"];
export type QualityIssue = Schemas["QualityIssue"];
export type DatasetPreview = Schemas["DatasetPreview"];
export type SuggestedQuestions = Schemas["SuggestedQuestions"];
export type UploadTicket = Schemas["UploadTicket"];

export type AnalysisSummary = Schemas["AnalysisSummary"];
export type Analysis = Schemas["AnalysisOut"];
export type AnalysisList = Schemas["AnalysisList"];
export type AnalysisStatus = AnalysisSummary["status"];
export type AnalysisMessage = Schemas["MessageOut"];
export type AnalysisEvent = Schemas["EventOut"];
export type AnalysisEvents = Schemas["EventsOut"];

export type ReportSummary = Schemas["ReportSummary"];
export type Report = Schemas["ReportOut"];
export type ReportList = Schemas["ReportList"];
export type ReportContent = Schemas["ReportContent"];
export type KeyMetric = Schemas["KeyMetric"];
export type Finding = Schemas["Finding"];
export type Anomaly = Schemas["Anomaly"];
export type Recommendation = Schemas["Recommendation"];
export type EvidenceRecord = Schemas["EvidenceRecord"];
export type Visualization = Schemas["Visualization"];
export type Verification = Schemas["Verification"];
export type Chart = Schemas["Chart"];
export type ChartSeries = Schemas["ChartSeries"];
export type DataTable = Schemas["Table"];
export type Level = Finding["significance"];

/** A single cell value as produced by the analysis tools. */
export type Scalar = string | number | boolean | null;

export type ExportFormat = "md" | "pdf" | "xlsx" | "csv";

export const ACTIVE_STATUSES: readonly AnalysisStatus[] = ["queued", "running"];

export function isActiveStatus(status: AnalysisStatus | undefined): boolean {
  return status === "queued" || status === "running";
}
