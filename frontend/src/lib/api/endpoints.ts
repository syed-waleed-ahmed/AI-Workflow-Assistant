import { apiFetch } from "./client";
import type {
  Analysis,
  AnalysisEvents,
  AnalysisList,
  AnalysisSummary,
  Dataset,
  DatasetList,
  DatasetPreview,
  Report,
  ReportList,
  SuggestedQuestions,
  UploadTicket,
  Usage,
  User,
} from "./types";

export interface PageParams {
  limit?: number;
  offset?: number;
}

const id = (value: string) => encodeURIComponent(value);

export const authApi = {
  register: (body: { email: string; password: string; name: string }) =>
    apiFetch<User>("/auth/register", { method: "POST", body }),
  login: (body: { email: string; password: string }) =>
    apiFetch<User>("/auth/login", { method: "POST", body }),
  logout: () => apiFetch<void>("/auth/logout", { method: "POST", handleUnauthorized: false }),
  me: () => apiFetch<User>("/auth/me"),
};

export const usersApi = {
  updateProfile: (body: { name: string }) => apiFetch<User>("/users/me", { method: "PATCH", body }),
  changePassword: (body: { current_password: string; new_password: string }) =>
    apiFetch<void>("/users/me/password", { method: "POST", body }),
  usage: () => apiFetch<Usage>("/users/me/usage"),
  deleteAccount: (body: { password: string }) =>
    apiFetch<void>("/users/me/delete", { method: "POST", body }),
};

export const datasetsApi = {
  list: (params: PageParams = {}) => apiFetch<DatasetList>("/datasets", { query: { ...params } }),
  get: (datasetId: string) => apiFetch<Dataset>(`/datasets/${id(datasetId)}`),
  preview: (datasetId: string, params: PageParams = {}) =>
    apiFetch<DatasetPreview>(`/datasets/${id(datasetId)}/preview`, { query: { ...params } }),
  suggestions: (datasetId: string) =>
    apiFetch<SuggestedQuestions>(`/datasets/${id(datasetId)}/suggestions`),
  rename: (datasetId: string, name: string) =>
    apiFetch<Dataset>(`/datasets/${id(datasetId)}`, { method: "PATCH", body: { name } }),
  remove: (datasetId: string) => apiFetch<void>(`/datasets/${id(datasetId)}`, { method: "DELETE" }),
  uploadTicket: () => apiFetch<UploadTicket>("/datasets/upload-ticket", { method: "POST" }),
};

export const analysesApi = {
  list: (params: PageParams & { dataset_id?: string } = {}) =>
    apiFetch<AnalysisList>("/analyses", { query: { ...params } }),
  get: (analysisId: string) => apiFetch<Analysis>(`/analyses/${id(analysisId)}`),
  create: (body: { dataset_id: string; question: string }) =>
    apiFetch<Analysis>("/analyses", { method: "POST", body }),
  followUp: (analysisId: string, question: string) =>
    apiFetch<Analysis>(`/analyses/${id(analysisId)}/messages`, {
      method: "POST",
      body: { question },
    }),
  events: (analysisId: string, after: number, signal?: AbortSignal) =>
    apiFetch<AnalysisEvents>(`/analyses/${id(analysisId)}/events`, { query: { after }, signal }),
  cancel: (analysisId: string) =>
    apiFetch<AnalysisSummary>(`/analyses/${id(analysisId)}/cancel`, { method: "POST" }),
  remove: (analysisId: string) =>
    apiFetch<void>(`/analyses/${id(analysisId)}`, { method: "DELETE" }),
};

export const reportsApi = {
  list: (params: PageParams = {}) => apiFetch<ReportList>("/reports", { query: { ...params } }),
  get: (reportId: string) => apiFetch<Report>(`/reports/${id(reportId)}`),
  remove: (reportId: string) => apiFetch<void>(`/reports/${id(reportId)}`, { method: "DELETE" }),
};
