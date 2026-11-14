import {
  Binary,
  Calendar,
  CircleOff,
  Equal,
  Fingerprint,
  Hash,
  Tags,
  ToggleLeft,
  Type,
  type LucideIcon,
} from "lucide-react";
import { Badge, type BadgeTone } from "@/components/ui/badge";

const KINDS: Record<string, { label: string; icon: LucideIcon }> = {
  numeric: { label: "Numeric", icon: Hash },
  datetime: { label: "Date/time", icon: Calendar },
  boolean: { label: "Boolean", icon: ToggleLeft },
  categorical: { label: "Categorical", icon: Tags },
  text: { label: "Text", icon: Type },
  identifier: { label: "Identifier", icon: Fingerprint },
  constant: { label: "Constant", icon: Equal },
  empty: { label: "Empty", icon: CircleOff },
};

export function kindLabel(kind: string): string {
  return KINDS[kind]?.label ?? kind;
}

/** The inferred role of a column. Kinds are told apart by icon and label, not colour. */
export function KindBadge({ kind }: { kind: string }) {
  const entry = KINDS[kind] ?? { label: kind, icon: Binary };
  const Icon = entry.icon;
  return (
    <Badge tone="neutral">
      <Icon aria-hidden="true" />
      {entry.label}
    </Badge>
  );
}

export function qualityTone(score: number): BadgeTone {
  if (score >= 85) return "success";
  if (score >= 60) return "warning";
  return "danger";
}

export function QualityBadge({ score }: { score: number }) {
  return (
    <Badge tone={qualityTone(score)} className="tabular" title="Data quality score out of 100">
      {score}
      <span className="sr-only"> out of 100</span>
    </Badge>
  );
}

const SEVERITY_TONE: Record<string, BadgeTone> = {
  high: "danger",
  error: "danger",
  critical: "danger",
  medium: "warning",
  warning: "warning",
  low: "neutral",
  info: "neutral",
};

export function SeverityBadge({ severity }: { severity: string }) {
  return <Badge tone={SEVERITY_TONE[severity.toLowerCase()] ?? "neutral"}>{severity}</Badge>;
}
