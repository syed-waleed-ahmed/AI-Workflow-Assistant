"use client";

import type { ReactNode } from "react";
import { ClientOnly } from "@/components/common/client-only";
import { RouteFallback } from "@/components/common/route-fallback";

/**
 * Wraps the content of a signed-in page. The server HTML is a loading skeleton; the real
 * content, which depends on data fetched in the browser, renders once the page is running
 * there (see `ClientOnly` for why).
 */
export function AppPage({ label, children }: { label: string; children: ReactNode }) {
  return <ClientOnly fallback={<RouteFallback label={label} />}>{children}</ClientOnly>;
}
