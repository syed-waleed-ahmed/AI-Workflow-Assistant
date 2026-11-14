import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Fades and lifts its content into place as it scrolls into view, using a CSS scroll-driven
 * animation (the `reveal` utility in globals.css). Content is never hidden by script: where
 * the browser lacks scroll-driven animations, when printing, or for visitors who prefer
 * reduced motion, it is simply shown. `delay` staggers siblings by shifting where in the
 * scroll their animation runs.
 */
export function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  const style =
    delay > 0 ? ({ "--reveal-offset": `${Math.round(delay * 100)}%` } as CSSProperties) : undefined;
  return (
    <div className={cn("reveal", className)} style={style}>
      {children}
    </div>
  );
}
