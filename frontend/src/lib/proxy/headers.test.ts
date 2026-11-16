import { describe, expect, it } from "vitest";
import {
  PROXY_CLIENT_IP_HEADER,
  PROXY_SECRET_HEADER,
  stampProxyHeaders,
  visitorAddress,
} from "./headers";

describe("proxy headers", () => {
  const SECRET = "s".repeat(40);

  it("prefers the address set by the hosting platform's edge", () => {
    const headers = new Headers({
      "x-forwarded-for": "203.0.113.9, 10.0.0.1",
      "x-real-ip": "198.51.100.2",
      "x-vercel-forwarded-for": "198.51.100.1",
    });
    expect(visitorAddress(headers)).toBe("198.51.100.1");
    headers.delete("x-vercel-forwarded-for");
    expect(visitorAddress(headers)).toBe("198.51.100.2");
    headers.delete("x-real-ip");
    expect(visitorAddress(headers)).toBe("203.0.113.9");
    expect(visitorAddress(new Headers())).toBeNull();
  });

  it("stamps the address and secret, replacing any stamp the caller sent", () => {
    const stamped = stampProxyHeaders(
      new Headers({
        "x-vercel-forwarded-for": "198.51.100.1",
        [PROXY_SECRET_HEADER]: "forged",
        [PROXY_CLIENT_IP_HEADER]: "203.0.113.66",
        "content-type": "application/json",
      }),
      SECRET,
    );
    expect(stamped?.get(PROXY_SECRET_HEADER)).toBe(SECRET);
    expect(stamped?.get(PROXY_CLIENT_IP_HEADER)).toBe("198.51.100.1");
    expect(stamped?.get("content-type")).toBe("application/json");
  });

  it("adds nothing without a secret or an address", () => {
    const headers = new Headers({ "x-real-ip": "198.51.100.2" });
    expect(stampProxyHeaders(headers, undefined)).toBeNull();
    expect(stampProxyHeaders(headers, "")).toBeNull();
    expect(stampProxyHeaders(new Headers(), SECRET)).toBeNull();
  });
});
