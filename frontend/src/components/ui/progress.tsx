"use client";

import { Progress as ProgressPrimitive } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

interface ProgressProps extends Omit<ComponentProps<typeof ProgressPrimitive.Root>, "value"> {
  /** 0–100, or null while the amount of work is unknown. */
  value: number | null;
  tone?: "primary" | "warning" | "danger";
}

const toneClass = {
  primary: "bg-primary",
  warning: "bg-warning-text",
  danger: "bg-destructive-text",
} as const;

function Progress({ className, value, tone = "primary", ...props }: ProgressProps) {
  const clamped = value === null ? null : Math.min(100, Math.max(0, value));
  return (
    <ProgressPrimitive.Root
      value={clamped}
      className={cn("relative h-1.5 w-full overflow-hidden rounded-full bg-muted", className)}
      {...props}
    >
      <ProgressPrimitive.Indicator
        className={cn(
          "h-full rounded-full transition-[width] duration-200",
          toneClass[tone],
          clamped === null && "w-1/3 animate-indeterminate",
        )}
        style={clamped === null ? undefined : { width: `${clamped}%` }}
      />
    </ProgressPrimitive.Root>
  );
}

export { Progress };
