import { cn } from "@/lib/utils";

/** The logomark: a trend line ending in a verified point, on the brand gradient. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "bg-brand-gradient inline-flex size-6 shrink-0 items-center justify-center rounded-[25%] shadow-sm ring-1 ring-black/5 ring-inset",
        className,
      )}
    >
      <svg viewBox="0 0 32 32" fill="none" className="size-full">
        <path
          d="M8 21.5 13.5 15l4 3.5L24 10.5"
          className="stroke-primary-foreground"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="24" cy="10.5" r="2.25" className="fill-primary-foreground" />
      </svg>
    </span>
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
