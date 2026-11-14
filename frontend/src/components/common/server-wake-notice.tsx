"use client";

import { Loader2 } from "lucide-react";
import { useSlowRequest } from "@/lib/api/activity";

/**
 * Appears when any API request has been pending for more than a few seconds. The API runs on
 * free hosting that sleeps when idle, so the first request after a pause can take up to a
 * minute; saying so is better than a spinner with no explanation.
 */
export function ServerWakeNotice() {
  const slow = useSlowRequest();
  return (
    <div
      role="status"
      aria-live="polite"
      data-print="hide"
      className="pointer-events-none fixed inset-x-0 bottom-4 z-60 flex justify-center px-4"
    >
      {slow ? (
        <div className="pointer-events-auto flex max-w-md animate-pop-in items-start gap-3 rounded-lg border border-border bg-popover px-4 py-3 text-sm shadow-md">
          <Loader2
            className="mt-0.5 size-4 shrink-0 animate-spin text-muted-foreground"
            aria-hidden="true"
          />
          <div>
            <p className="font-medium">Waking up the server…</p>
            <p className="text-muted-foreground">
              The API sleeps when idle on free hosting. The first request can take up to a minute.
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
