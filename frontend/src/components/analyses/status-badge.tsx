import { Ban, Check, CircleAlert, Clock, Loader2 } from "lucide-react";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import type { AnalysisStatus } from "@/lib/api/types";

const STATUS: Record<
  AnalysisStatus,
  { label: string; tone: BadgeTone; icon: typeof Check; spin?: boolean }
> = {
  queued: { label: "Queued", tone: "neutral", icon: Clock },
  running: { label: "Running", tone: "accent", icon: Loader2, spin: true },
  completed: { label: "Completed", tone: "success", icon: Check },
  failed: { label: "Failed", tone: "danger", icon: CircleAlert },
  cancelled: { label: "Cancelled", tone: "outline", icon: Ban },
};

export function StatusBadge({ status, className }: { status: AnalysisStatus; className?: string }) {
  const { label, tone, icon: Icon, spin } = STATUS[status];
  return (
    <Badge tone={tone} className={className}>
      <Icon className={spin ? "animate-spin" : undefined} aria-hidden="true" />
      {label}
    </Badge>
  );
}
