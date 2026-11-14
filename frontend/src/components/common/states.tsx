import { AlertTriangle, RotateCw, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { ApiError, errorMessage } from "@/lib/api/client";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: ReactNode;
  /** The next thing the person can do from here. */
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-3 rounded-lg border border-dashed border-border px-6 py-10 text-center",
        className,
      )}
    >
      <span className="flex size-10 items-center justify-center rounded-md bg-muted text-muted-foreground">
        <Icon className="size-5" aria-hidden="true" />
      </span>
      <div className="max-w-md space-y-1">
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="text-sm leading-6 text-muted-foreground">{description}</p>
      </div>
      {action ? <div className="mt-1 flex flex-wrap justify-center gap-2">{action}</div> : null}
    </div>
  );
}

interface ErrorStateProps {
  error: unknown;
  title?: string;
  onRetry?: () => void;
  retrying?: boolean;
  action?: ReactNode;
  className?: string;
}

export function ErrorState({
  error,
  title = "This could not be loaded",
  onRetry,
  retrying = false,
  action,
  className,
}: ErrorStateProps) {
  const requestId = error instanceof ApiError ? error.requestId : null;
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center gap-3 rounded-lg border border-border px-6 py-10 text-center",
        className,
      )}
    >
      <span className="flex size-10 items-center justify-center rounded-md bg-destructive-soft text-destructive-text">
        <AlertTriangle className="size-5" aria-hidden="true" />
      </span>
      <div className="max-w-md space-y-1">
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="text-sm leading-6 text-muted-foreground">{errorMessage(error)}</p>
        {requestId ? (
          <p className="font-mono text-xs text-muted-foreground">Request ID: {requestId}</p>
        ) : null}
      </div>
      <div className="mt-1 flex flex-wrap justify-center gap-2">
        {onRetry ? (
          <Button variant="outline" size="sm" onClick={onRetry} loading={retrying}>
            {retrying ? null : <RotateCw aria-hidden="true" />}
            Try again
          </Button>
        ) : null}
        {action}
      </div>
    </div>
  );
}

/** An inline error message for forms and dialogs. */
export function InlineError({ children, className }: { children: ReactNode; className?: string }) {
  if (!children) return null;
  return (
    <div
      role="alert"
      className={cn(
        "flex items-start gap-2 rounded-md bg-destructive-soft px-3 py-2 text-sm leading-5 text-destructive-text",
        className,
      )}
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <span className="min-w-0 wrap-break-word">{children}</span>
    </div>
  );
}
