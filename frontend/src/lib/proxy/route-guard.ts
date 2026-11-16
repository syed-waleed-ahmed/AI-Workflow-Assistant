export const SESSION_COOKIE = "awa_session";

export interface GuardInput {
  pathname: string;
  search: string;
  hasSession: boolean;
}

/**
 * Decides whether a navigation should be redirected, returning the target path or null.
 *
 * This is a convenience only: it keeps signed-out visitors away from the app shell and
 * signed-in users away from the sign-in pages. The API enforces real authentication on
 * every request, and the session cookie cannot be validated here.
 */
export function resolveRedirect({ pathname, search, hasSession }: GuardInput): string | null {
  const isApp = pathname === "/app" || pathname.startsWith("/app/");
  const isAuthPage = pathname === "/login" || pathname === "/register";

  if (isApp && !hasSession) {
    const next = `${pathname}${search}`;
    return next === "/app" ? "/login" : `/login?next=${encodeURIComponent(next)}`;
  }

  if (isAuthPage && hasSession) {
    // The API rejected the session cookie; let the person sign in again instead of looping.
    if (new URLSearchParams(search).has("expired")) return null;
    return "/app";
  }

  return null;
}
