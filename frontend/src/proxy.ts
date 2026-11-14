import { NextResponse, type NextRequest } from "next/server";
import { resolveRedirect, SESSION_COOKIE } from "@/lib/route-guard";

/*
 * Next.js 16 renamed the `middleware.ts` convention to `proxy.ts`; this file is that
 * route guard. It only looks at whether the session cookie exists (see route-guard.ts).
 */
export function proxy(request: NextRequest) {
  const target = resolveRedirect({
    pathname: request.nextUrl.pathname,
    search: request.nextUrl.search,
    hasSession: request.cookies.has(SESSION_COOKIE),
  });
  if (!target) return NextResponse.next();
  return NextResponse.redirect(new URL(target, request.url));
}

export const config = {
  // API requests are deliberately excluded so uploads are never buffered here.
  matcher: ["/app/:path*", "/login", "/register"],
};
