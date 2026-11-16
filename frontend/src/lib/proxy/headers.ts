/*
 * The API limits sign-in and registration attempts per visitor address. Requests reach it
 * through this app's proxy, so on their own they would all appear to come from the proxy.
 * The proxy therefore stamps each forwarded auth request with the visitor's address and a
 * secret shared with the API; the API trusts the address only when the secret matches.
 */
export const PROXY_SECRET_HEADER = "x-awa-proxy-secret";
export const PROXY_CLIENT_IP_HEADER = "x-awa-client-ip";

// Most trustworthy first. Vercel sets `x-vercel-forwarded-for` and `x-real-ip` at its edge;
// `x-forwarded-for` is the fallback for other hosts.
const ADDRESS_HEADERS = ["x-vercel-forwarded-for", "x-real-ip", "x-forwarded-for"] as const;

/** The visitor's address as reported by the hosting platform, or null when it is unknown. */
export function visitorAddress(headers: Headers): string | null {
  for (const name of ADDRESS_HEADERS) {
    const first = headers.get(name)?.split(",")[0]?.trim();
    if (first) return first.slice(0, 64);
  }
  return null;
}

/**
 * Request headers to forward to the API, stamped with the visitor's address. Any stamp the
 * caller sent is discarded. Returns null when there is nothing to add: no secret configured,
 * or no address to report.
 */
export function stampProxyHeaders(incoming: Headers, secret: string | undefined): Headers | null {
  if (!secret) return null;
  const address = visitorAddress(incoming);
  if (!address) return null;
  const headers = new Headers(incoming);
  headers.set(PROXY_SECRET_HEADER, secret);
  headers.set(PROXY_CLIENT_IP_HEADER, address);
  return headers;
}
