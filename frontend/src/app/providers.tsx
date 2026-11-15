"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MotionConfig } from "motion/react";
import { ThemeProvider } from "next-themes";
import { useEffect, useState, type ReactNode } from "react";
import { Toaster } from "@/components/ui/sonner";
import { ApiError, setUnauthorizedHandler } from "@/lib/api/client";
import { hardNavigate } from "@/lib/navigation";

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        // Retry only when the request never got an answer from the API (network failure or a
        // sleeping server). Anything the API actually said, 4xx included, is final.
        retry: (failureCount, error) =>
          error instanceof ApiError ? error.isTransient && failureCount < 4 : failureCount < 1,
        retryDelay: (attempt) => Math.min(1500 * 2 ** attempt, 12_000),
      },
      mutations: { retry: false },
    },
  });
}

let redirecting = false;

/** Session expired while using the app: drop cached data and ask the person to sign in again. */
function handleUnauthorized(queryClient: QueryClient): void {
  if (redirecting || typeof window === "undefined") return;
  const { pathname, search } = window.location;
  if (!(pathname === "/app" || pathname.startsWith("/app/"))) return;
  redirecting = true;
  queryClient.clear();
  // Best effort: have the API clear the stale HttpOnly cookie, which script cannot remove.
  void fetch("/api/v1/auth/logout", {
    method: "POST",
    credentials: "same-origin",
    keepalive: true,
  }).catch(() => undefined);
  const next = encodeURIComponent(`${pathname}${search}`);
  hardNavigate(`/login?next=${next}&expired=1`);
}

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(createQueryClient);

  useEffect(() => {
    setUnauthorizedHandler(() => handleUnauthorized(queryClient));
    return () => setUnauthorizedHandler(null);
  }, [queryClient]);

  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      {/* "user": transform animations are skipped for visitors who prefer reduced motion. */}
      <MotionConfig reducedMotion="user">
        <QueryClientProvider client={queryClient}>
          {children}
          <Toaster />
        </QueryClientProvider>
      </MotionConfig>
    </ThemeProvider>
  );
}
