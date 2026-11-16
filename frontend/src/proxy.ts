import { NextResponse, type NextRequest } from "next/server";
import { stampProxyHeaders } from "@/lib/proxy/headers";
import { resolveRedirect, SESSION_COOKIE } from "@/lib/proxy/route-guard";

/*
 * Next.js 16 renamed the `middleware.ts` convention to `proxy.ts`. This file does two things:
 * - guards app routes on whether the session cookie exists (see lib/proxy/route-guard.ts);
 * - stamps forwarded sign-in and registration requests with the visitor's address, so the
 *   API's per-address limit applies per visitor (see lib/proxy/headers.ts).
 */
export function proxy(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith("/api/")) {
    const headers = stampProxyHeaders(request.headers, process.env.PROXY_SHARED_SECRET);
    return headers ? NextResponse.next({ request: { headers } }) : NextResponse.next();
  }

  const target = resolveRedirect({
    pathname: request.nextUrl.pathname,
    search: request.nextUrl.search,
    hasSession: request.cookies.has(SESSION_COOKIE),
  });
  if (!target) return NextResponse.next();
  return NextResponse.redirect(new URL(target, request.url));
}

export const config = {
  // Only the small JSON auth requests pass through here among API calls: the proxy buffers
  // request bodies, and uploads must not be buffered.
  matcher: ["/app/:path*", "/login", "/register", "/api/v1/auth/:path*"],
};
