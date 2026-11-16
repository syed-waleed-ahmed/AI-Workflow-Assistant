import type { NextConfig } from "next";

const backendUrl = (process.env.BACKEND_URL ?? "http://localhost:8000").replace(/\/+$/, "");
const isDev = process.env.NODE_ENV !== "production";

function originOf(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

// Large uploads bypass the frontend proxy in production and go straight to the API host.
const directApiOrigin = originOf(process.env.NEXT_PUBLIC_API_DIRECT_URL);

const contentSecurityPolicy = [
  "default-src 'self'",
  // Next.js injects inline bootstrap scripts into prerendered pages, and a nonce would force
  // every page to render dynamically. React's dev tooling additionally needs eval.
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self'${directApiOrigin ? ` ${directApiOrigin}` : ""}${isDev ? " ws: wss:" : ""}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  poweredByHeader: false,
  experimental: {
    // The API may be waking from a cold start; do not cut proxied requests off early.
    proxyTimeout: 120_000,
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async rewrites() {
    // The browser only ever talks to this origin; the API is reached through this proxy so
    // the session cookies are first-party.
    return [{ source: "/api/:path*", destination: `${backendUrl}/api/:path*` }];
  },
  async redirects() {
    // Reports are listed with the analyses that produced them; keep old bookmarks working.
    return [{ source: "/app/reports", destination: "/app/analyses", permanent: true }];
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
