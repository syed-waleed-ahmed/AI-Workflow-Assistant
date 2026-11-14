"use client";

import { ErrorState } from "@/components/common/states";
import { Progress } from "@/components/ui/progress";
import { LoadingRegion, Skeleton } from "@/components/ui/skeleton";
import type { Usage } from "@/lib/api/types";
import { formatBytes, formatInteger } from "@/lib/format";
import { useUsage } from "@/lib/query/hooks";
import { cn } from "@/lib/utils";

interface MeterProps {
  label: string;
  used: number;
  limit: number;
  /** Text for the "x of y" readout. */
  format?: (value: number) => string;
  hint?: string;
}

function Meter({ label, used, limit, format = formatInteger, hint }: MeterProps) {
  const percent = limit > 0 ? (used / limit) * 100 : 0;
  const tone = percent >= 100 ? "danger" : percent >= 80 ? "warning" : "primary";
  const readout = `${format(used)} of ${format(limit)}`;
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="tabular font-medium whitespace-nowrap">{readout}</span>
      </div>
      <Progress value={percent} tone={tone} aria-label={`${label}: ${readout}`} />
      {hint ? <p className="text-xs leading-5 text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function UsageMetersContent({ usage, className }: { usage: Usage; className?: string }) {
  const limitReached = usage.analyses_today >= usage.daily_analysis_limit;
  return (
    <div className={cn("grid gap-5 sm:grid-cols-3", className)}>
      <Meter
        label="Analyses (last 24 hours)"
        used={usage.analyses_today}
        limit={usage.daily_analysis_limit}
        hint={
          limitReached
            ? "Daily limit reached. Each question, including follow-ups, counts as one."
            : undefined
        }
      />
      <Meter
        label="Storage"
        used={usage.storage_used_bytes}
        limit={usage.storage_quota_bytes}
        format={formatBytes}
      />
      <Meter label="Datasets" used={usage.datasets} limit={usage.max_datasets} />
    </div>
  );
}

/** Live usage against the account limits reported by the API. */
export function UsageMeters({ className }: { className?: string }) {
  const usage = useUsage();
  if (usage.isPending) {
    return (
      <LoadingRegion label="Loading usage" className={cn("grid gap-5 sm:grid-cols-3", className)}>
        <Skeleton className="h-10" />
        <Skeleton className="h-10" />
        <Skeleton className="h-10" />
      </LoadingRegion>
    );
  }
  if (usage.isError) {
    return (
      <ErrorState
        error={usage.error}
        title="Usage could not be loaded"
        onRetry={() => void usage.refetch()}
        retrying={usage.isFetching}
        className="py-6"
      />
    );
  }
  return <UsageMetersContent usage={usage.data} className={className} />;
}
