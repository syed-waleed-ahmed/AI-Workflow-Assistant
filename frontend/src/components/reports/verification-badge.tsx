import { ShieldAlert, ShieldCheck } from "lucide-react";
import type { Verification } from "@/lib/api/types";
import { cn } from "@/lib/utils";

/** The headline sentence for a verification outcome. */
export function verificationSummary(verification: Verification): string {
  const checked = verification.numbers_checked;
  const unverified = verification.unverified_numbers?.length ?? 0;
  if (verification.status === "verified") {
    if (checked === 0) return "No numeric figures needed verification";
    if (checked === 1) return "The 1 figure in this report was verified against computed results";
    return `All ${checked} figures verified against computed results`;
  }
  const noun = unverified === 1 ? "figure" : "figures";
  return `Partially verified: ${unverified} of ${checked} ${noun} could not be traced to a computation`;
}

/**
 * States whether every figure in the report was matched to a value computed by the analysis
 * tools. Unverified figures are listed rather than hidden.
 */
export function VerificationBadge({
  verification,
  className,
}: {
  verification: Verification;
  className?: string;
}) {
  const verified = verification.status === "verified";
  const Icon = verified ? ShieldCheck : ShieldAlert;
  const unverified = verification.unverified_numbers ?? [];
  return (
    <div
      data-status={verification.status}
      className={cn(
        "flex items-start gap-2.5 rounded-md px-3 py-2 text-sm leading-5",
        verified ? "bg-success-soft text-success-text" : "bg-warning-soft text-warning-text",
        className,
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0">
        <p className="font-medium">{verificationSummary(verification)}</p>
        {!verified && unverified.length > 0 ? (
          <p className="mt-0.5 wrap-break-word">
            Unverified:{" "}
            <span className="tabular font-mono text-[13px]">{unverified.join(", ")}</span>
          </p>
        ) : null}
      </div>
    </div>
  );
}
