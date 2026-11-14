import { useSyncExternalStore } from "react";

/**
 * Tracks requests that have been in flight for longer than a threshold, so the UI can say
 * "Waking up the server…" instead of leaving the user looking at a silent spinner. The API
 * runs on free hosting that sleeps when idle; a cold start can take up to a minute.
 */
export const SLOW_REQUEST_MS = 4000;

let slowRequests = 0;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

/** Call when a request starts; call the returned function when it settles. */
export function trackRequest(thresholdMs: number = SLOW_REQUEST_MS): () => void {
  let counted = false;
  let finished = false;
  const timer = setTimeout(() => {
    if (finished) return;
    counted = true;
    slowRequests += 1;
    notify();
  }, thresholdMs);

  return () => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    if (counted) {
      slowRequests -= 1;
      notify();
    }
  };
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): boolean {
  return slowRequests > 0;
}

function getServerSnapshot(): boolean {
  return false;
}

/** True while at least one API request has been pending for longer than the threshold. */
export function useSlowRequest(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** Test helper. */
export function resetRequestActivity(): void {
  slowRequests = 0;
  notify();
}
