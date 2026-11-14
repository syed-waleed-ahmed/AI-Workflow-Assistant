"use client";

import { useSyncExternalStore } from "react";
import { formatDateTime } from "@/lib/format";

const subscribe = () => () => undefined;

const utcFormat = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

/**
 * A timestamp in the viewer's time zone. Prerendered HTML cannot know that zone, so it shows
 * UTC and switches to local time once the page is running in the browser.
 */
export function DateTime({ iso, className }: { iso: string; className?: string }) {
  const inBrowser = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  const date = new Date(iso);
  const text = Number.isNaN(date.getTime())
    ? iso
    : inBrowser
      ? formatDateTime(iso)
      : `${utcFormat.format(date)} UTC`;
  return (
    <time dateTime={iso} className={className}>
      {text}
    </time>
  );
}
