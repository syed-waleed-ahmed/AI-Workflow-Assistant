"use client";

import { useSyncExternalStore, type ReactNode } from "react";

const subscribe = () => () => undefined;

/** False on the server and while hydrating, true once the component is running in the browser. */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}

/**
 * Renders `children` only in the browser, and `fallback` in the server HTML.
 *
 * The signed-in pages are driven entirely by data fetched in the browser. Sections of a page
 * hydrate at different moments, so a section hydrating late could already find that data in
 * the cache and disagree with the server-rendered loading state. Hydrating the fallback and
 * then rendering the real content avoids that mismatch.
 */
export function ClientOnly({
  children,
  fallback = null,
}: {
  children: ReactNode;
  fallback?: ReactNode;
}) {
  return useHydrated() ? children : fallback;
}
