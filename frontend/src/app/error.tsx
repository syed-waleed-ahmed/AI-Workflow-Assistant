"use client";

import { AlertTriangle, RotateCw } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="flex min-h-dvh flex-1 flex-col items-center justify-center gap-4 px-4 text-center">
      <span className="flex size-10 items-center justify-center rounded-md bg-destructive-soft text-destructive-text">
        <AlertTriangle className="size-5" aria-hidden="true" />
      </span>
      <div className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">Something went wrong</h1>
        <p className="max-w-sm text-sm leading-6 text-muted-foreground">
          This page hit an unexpected error. Your data has not been affected. Try again, or go back
          to the dashboard.
        </p>
        {error.digest ? (
          <p className="font-mono text-xs text-muted-foreground">Reference: {error.digest}</p>
        ) : null}
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        <Button size="sm" onClick={reset}>
          <RotateCw aria-hidden="true" />
          Try again
        </Button>
        <Button asChild size="sm" variant="outline">
          <Link href="/app">Go to the dashboard</Link>
        </Button>
      </div>
    </main>
  );
}
