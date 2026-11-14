"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { CSRF_COOKIE, readCookie } from "@/lib/api/client";

const subscribe = () => () => undefined;

/**
 * Header actions for the public page. The readable CSRF cookie is set together with the
 * session, so its presence is a good hint that the visitor is signed in; the hint only
 * changes which link is shown.
 */
export function LandingAuthLinks() {
  const signedIn = useSyncExternalStore(
    subscribe,
    () => readCookie(CSRF_COOKIE) !== null,
    () => false,
  );

  if (signedIn) {
    return (
      <Button size="sm" asChild>
        <Link href="/app">Open app</Link>
      </Button>
    );
  }
  return (
    <>
      <Button variant="ghost" size="sm" asChild>
        <Link href="/login">Sign in</Link>
      </Button>
      <Button size="sm" asChild>
        <Link href="/register">Get started</Link>
      </Button>
    </>
  );
}
