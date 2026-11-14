"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { errorMessage } from "@/lib/api/client";
import { useCreateAnalysis } from "@/lib/query/hooks";

/** Why a new analysis could not be queued, in words that say what to do next. */
export function startAnalysisError(error: unknown): string {
  return errorMessage(error, "The analysis could not be started. Please try again.");
}

/** Queues an analysis and opens its workspace, where progress is shown live. */
export function useStartAnalysis() {
  const router = useRouter();
  const create = useCreateAnalysis();

  const start = async (datasetId: string, question: string) => {
    try {
      const analysis = await create.mutateAsync({ dataset_id: datasetId, question });
      router.push(`/app/analyses/${analysis.id}`);
      return analysis;
    } catch (error) {
      toast.error(startAnalysisError(error));
      throw error;
    }
  };

  return { start, pending: create.isPending };
}
