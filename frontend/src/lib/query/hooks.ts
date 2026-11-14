"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { mergeEvents, type EventsState } from "@/lib/analysis/timeline";
import {
  analysesApi,
  authApi,
  datasetsApi,
  reportsApi,
  usersApi,
  type PageParams,
} from "@/lib/api/endpoints";
import type { Analysis, AnalysisList, Dataset, User } from "@/lib/api/types";
import { isActiveStatus } from "@/lib/api/types";
import { uploadDataset, type UploadOptions } from "@/lib/api/upload";
import { queryKeys } from "./keys";

export const EVENTS_POLL_MS = 1500;
const LIST_POLL_MS = 5000;

/* ----------------------------------------------------------------------------- account */

export function useMe() {
  return useQuery({ queryKey: queryKeys.me, queryFn: authApi.me, staleTime: 5 * 60_000 });
}

export function useUsage() {
  return useQuery({ queryKey: queryKeys.usage, queryFn: usersApi.usage });
}

export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: authApi.login,
    onSuccess: (user) => {
      queryClient.clear();
      queryClient.setQueryData<User>(queryKeys.me, user);
    },
  });
}

export function useRegister() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: authApi.register,
    onSuccess: (user) => {
      queryClient.clear();
      queryClient.setQueryData<User>(queryKeys.me, user);
    },
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: authApi.logout,
    onSettled: () => queryClient.clear(),
  });
}

export function useUpdateProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: usersApi.updateProfile,
    onSuccess: (user) => queryClient.setQueryData<User>(queryKeys.me, user),
  });
}

export function useChangePassword() {
  return useMutation({ mutationFn: usersApi.changePassword });
}

export function useDeleteAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: usersApi.deleteAccount,
    onSuccess: () => queryClient.clear(),
  });
}

/* ---------------------------------------------------------------------------- datasets */

export function useDatasets(params: PageParams = {}) {
  return useQuery({
    queryKey: queryKeys.datasets(params),
    queryFn: () => datasetsApi.list(params),
    placeholderData: keepPreviousData,
  });
}

export function useDataset(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.dataset(id ?? ""),
    queryFn: () => datasetsApi.get(id ?? ""),
    enabled: Boolean(id),
    staleTime: 5 * 60_000,
  });
}

export function useDatasetPreview(id: string, params: PageParams) {
  return useQuery({
    queryKey: queryKeys.datasetPreview(id, params),
    queryFn: () => datasetsApi.preview(id, params),
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
  });
}

export function useDatasetSuggestions(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.datasetSuggestions(id ?? ""),
    queryFn: () => datasetsApi.suggestions(id ?? ""),
    enabled: Boolean(id),
    staleTime: 10 * 60_000,
  });
}

export function useUploadDataset() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (options: UploadOptions) => uploadDataset(options),
    onSuccess: (dataset) => {
      queryClient.setQueryData<Dataset>(queryKeys.dataset(dataset.id), dataset);
      void queryClient.invalidateQueries({ queryKey: queryKeys.datasetsAll });
      void queryClient.invalidateQueries({ queryKey: queryKeys.usage });
    },
  });
}

export function useRenameDataset() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => datasetsApi.rename(id, name),
    onSuccess: (dataset) => {
      queryClient.setQueryData<Dataset>(queryKeys.dataset(dataset.id), dataset);
      void queryClient.invalidateQueries({ queryKey: queryKeys.datasetsAll });
    },
  });
}

export function useDeleteDataset() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => datasetsApi.remove(id),
    onSuccess: (_result, id) => {
      queryClient.removeQueries({ queryKey: queryKeys.dataset(id) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.datasetsAll });
      void queryClient.invalidateQueries({ queryKey: queryKeys.usage });
      void queryClient.invalidateQueries({ queryKey: queryKeys.analysesLists });
    },
  });
}

/* ---------------------------------------------------------------------------- analyses */

function anyActive(list: AnalysisList | undefined): boolean {
  return Boolean(list?.items.some((item) => isActiveStatus(item.status)));
}

/** Analysis lists poll while anything in them is still running, so status badges stay live. */
export function useAnalyses(params: PageParams & { dataset_id?: string } = {}) {
  return useQuery({
    queryKey: queryKeys.analyses(params),
    queryFn: () => analysesApi.list(params),
    placeholderData: keepPreviousData,
    refetchInterval: (query) => (anyActive(query.state.data) ? LIST_POLL_MS : false),
  });
}

export function useAnalysis(id: string) {
  return useQuery({ queryKey: queryKeys.analysis(id), queryFn: () => analysesApi.get(id) });
}

/**
 * Polls the progress events of an analysis while it is queued or running.
 *
 * Each poll asks only for events newer than the last one seen and appends them to what is
 * already cached, so leaving the page and coming back resumes where it stopped.
 */
export function useAnalysisEvents(id: string) {
  const queryClient = useQueryClient();
  const key = queryKeys.analysisEvents(id);
  return useQuery({
    queryKey: key,
    queryFn: async ({ signal }) => {
      const previous = queryClient.getQueryData<EventsState>(key);
      const response = await analysesApi.events(id, previous?.lastId ?? 0, signal);
      const next = mergeEvents(previous, response);
      const finished = !isActiveStatus(next.status);
      if (finished && previous !== undefined && isActiveStatus(previous.status)) {
        // The run just ended: refresh everything that depends on its outcome.
        void queryClient.invalidateQueries({ queryKey: queryKeys.analysis(id) });
        void queryClient.invalidateQueries({ queryKey: queryKeys.analysesLists });
        void queryClient.invalidateQueries({ queryKey: queryKeys.reportsLists });
        void queryClient.invalidateQueries({ queryKey: queryKeys.usage });
      }
      return next;
    },
    refetchInterval: (query) => (isActiveStatus(query.state.data?.status) ? EVENTS_POLL_MS : false),
    staleTime: 0,
    gcTime: 30 * 60_000,
    structuralSharing: false,
  });
}

function seedActiveAnalysis(queryClient: ReturnType<typeof useQueryClient>, analysis: Analysis) {
  queryClient.setQueryData<Analysis>(queryKeys.analysis(analysis.id), analysis);
  const key = queryKeys.analysisEvents(analysis.id);
  const previous = queryClient.getQueryData<EventsState>(key);
  queryClient.setQueryData<EventsState>(key, {
    status: analysis.status,
    turn: analysis.turn,
    error: null,
    events: [],
    lastId: previous?.lastId ?? 0,
  });
  void queryClient.invalidateQueries({ queryKey: key });
  void queryClient.invalidateQueries({ queryKey: queryKeys.analysesLists });
  void queryClient.invalidateQueries({ queryKey: queryKeys.usage });
}

export function useCreateAnalysis() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: analysesApi.create,
    onSuccess: (analysis) => seedActiveAnalysis(queryClient, analysis),
  });
}

export function useFollowUp(analysisId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (question: string) => analysesApi.followUp(analysisId, question),
    onSuccess: (analysis) => seedActiveAnalysis(queryClient, analysis),
  });
}

export function useCancelAnalysis(analysisId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => analysesApi.cancel(analysisId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.analysisEvents(analysisId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.analysis(analysisId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.analysesLists });
    },
  });
}

export function useDeleteAnalysis() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => analysesApi.remove(id),
    onSuccess: (_result, id) => {
      queryClient.removeQueries({ queryKey: queryKeys.analysis(id) });
      queryClient.removeQueries({ queryKey: queryKeys.analysisEvents(id) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.analysesLists });
      void queryClient.invalidateQueries({ queryKey: queryKeys.reportsAll });
      void queryClient.invalidateQueries({ queryKey: queryKeys.usage });
    },
  });
}

/* ----------------------------------------------------------------------------- reports */

export function useReports(params: PageParams = {}) {
  return useQuery({
    queryKey: queryKeys.reports(params),
    queryFn: () => reportsApi.list(params),
    placeholderData: keepPreviousData,
  });
}

export function useReport(id: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.report(id ?? ""),
    queryFn: () => reportsApi.get(id ?? ""),
    enabled: Boolean(id),
    // A stored report never changes.
    staleTime: Infinity,
  });
}

export function useDeleteReport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => reportsApi.remove(id),
    onSuccess: (_result, id) => {
      queryClient.removeQueries({ queryKey: queryKeys.report(id) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.reportsLists });
      void queryClient.invalidateQueries({ queryKey: queryKeys.analysesAll });
      void queryClient.invalidateQueries({ queryKey: queryKeys.usage });
    },
  });
}
