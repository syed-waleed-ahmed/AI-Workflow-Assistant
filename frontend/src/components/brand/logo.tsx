import { cn } from "@/lib/utils";

/** The logomark: a trend line ending in a verified point. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      className={cn("size-6 shrink-0", className)}
    >
      <rect width="32" height="32" rx="8" className="fill-primary" />
      <path
        d="M8 21.5 13.5 15l4 3.5L24 10.5"
        className="stroke-primary-foreground"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="24" cy="10.5" r="2.25" className="fill-primary-foreground" />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 text-sm font-semibold tracking-tight",
        className,
      )}
    >
      <LogoMark />
      <span>AI Workflow Assistant</span>
    </span>
  );
}
