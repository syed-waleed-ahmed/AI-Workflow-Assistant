/**
 * A full-page navigation. Used when the session changes (sign in, sign out, account deleted)
 * so the route guard runs against the new cookies and no client-side cache survives.
 */
export function hardNavigate(url: string): void {
  window.location.assign(url);
}
