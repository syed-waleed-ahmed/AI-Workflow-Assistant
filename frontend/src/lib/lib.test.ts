import { describe, expect, it } from "vitest";
import { parseFigure } from "@/components/motion/number-ticker";
import {
  formatBytes,
  formatCell,
  formatCompact,
  formatDuration,
  formatNumber,
  formatReadable,
  formatRelative,
} from "./format";
import {
  PROXY_CLIENT_IP_HEADER,
  PROXY_SECRET_HEADER,
  stampProxyHeaders,
  visitorAddress,
} from "./proxy-headers";
import { resolveRedirect } from "./route-guard";
import {
  loginSchema,
  newPasswordSchema,
  questionSchema,
  registerSchema,
  safeNextPath,
} from "./validation";

describe("number ticker figures", () => {
  it("splits a formatted figure into what the animation needs", () => {
    expect(parseFigure("4,851,042.44")).toEqual({
      prefix: "",
      number: 4851042.44,
      suffix: "",
      decimals: 2,
      grouped: true,
    });
    expect(parseFigure("-49.08%")).toMatchObject({ number: -49.08, suffix: "%", decimals: 2 });
    expect(parseFigure("$1.2M")).toMatchObject({ prefix: "$", number: 1.2, suffix: "M" });
    expect(parseFigure("12")).toMatchObject({ number: 12, decimals: 0, grouped: false });
  });

  it("leaves text that is not a figure alone", () => {
    expect(parseFigure("n/a")).toBeNull();
    expect(parseFigure("")).toBeNull();
  });
});

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

describe("route guard", () => {
  it("sends signed-out visitors to the sign-in page and remembers where they were going", () => {
    expect(resolveRedirect({ pathname: "/app", search: "", hasSession: false })).toBe("/login");
    expect(
      resolveRedirect({ pathname: "/app/datasets/abc", search: "?tab=preview", hasSession: false }),
    ).toBe("/login?next=%2Fapp%2Fdatasets%2Fabc%3Ftab%3Dpreview");
  });

  it("keeps signed-in users out of the sign-in pages", () => {
    expect(resolveRedirect({ pathname: "/login", search: "", hasSession: true })).toBe("/app");
    expect(resolveRedirect({ pathname: "/register", search: "", hasSession: true })).toBe("/app");
  });

  it("does not bounce back to the app when the API has rejected the session cookie", () => {
    expect(
      resolveRedirect({ pathname: "/login", search: "?next=%2Fapp&expired=1", hasSession: true }),
    ).toBeNull();
  });

  it("leaves everything else alone", () => {
    expect(resolveRedirect({ pathname: "/app/reports", search: "", hasSession: true })).toBeNull();
    expect(resolveRedirect({ pathname: "/login", search: "", hasSession: false })).toBeNull();
    expect(resolveRedirect({ pathname: "/application", search: "", hasSession: false })).toBeNull();
  });
});

describe("validation mirrors the API rules", () => {
  const messages = (result: { success: boolean; error?: { issues: { message: string }[] } }) =>
    result.error?.issues.map((issue) => issue.message) ?? [];

  it("enforces password length, rejects all-digit and low-variety passwords", () => {
    expect(messages(newPasswordSchema.safeParse("short1!"))).toEqual([
      "Password must be at least 10 characters long.",
    ]);
    expect(messages(newPasswordSchema.safeParse("1234567890123"))).toEqual([
      "Password is too simple. Mix letters, numbers or symbols.",
    ]);
    expect(messages(newPasswordSchema.safeParse("abababababab"))).toEqual([
      "Password is too simple. Mix letters, numbers or symbols.",
    ]);
    expect(messages(newPasswordSchema.safeParse("x".repeat(129)))).toContain(
      "Password must be at most 128 characters long.",
    );
    expect(newPasswordSchema.safeParse("correct horse 42").success).toBe(true);
  });

  it("validates email shape and trims the name", () => {
    expect(loginSchema.safeParse({ email: "not-an-email", password: "x" }).success).toBe(false);
    const parsed = registerSchema.safeParse({
      name: "  Ada  ",
      email: " ada@example.com ",
      password: "correct horse 42",
    });
    expect(parsed.success && parsed.data).toMatchObject({ name: "Ada", email: "ada@example.com" });
    expect(
      registerSchema.safeParse({
        name: "   ",
        email: "ada@example.com",
        password: "correct horse 42",
      }).success,
    ).toBe(false);
  });

  it("collapses whitespace in questions and requires three characters", () => {
    expect(questionSchema.safeParse("  which   region\n grew? ").data).toBe("which region grew?");
    expect(questionSchema.safeParse(" a ").success).toBe(false);
    expect(questionSchema.safeParse("x".repeat(2001)).success).toBe(false);
  });

  it("only accepts in-app paths as a post-login destination", () => {
    expect(safeNextPath("/app/reports/1")).toBe("/app/reports/1");
    expect(safeNextPath("https://evil.example")).toBe("/app");
    expect(safeNextPath("//evil.example/app")).toBe("/app");
    expect(safeNextPath("/login")).toBe("/app");
    expect(safeNextPath(null)).toBe("/app");
  });
});

describe("formatting", () => {
  it("abbreviates large numbers for axes and keeps small ones readable", () => {
    expect(formatCompact(4851042.44)).toBe("4.9M");
    expect(formatCompact(1200)).toBe("1.2K");
    expect(formatCompact(250.2222)).toBe("250.22");
    expect(formatCompact(0.0123)).toBe("0.012");
    expect(formatCompact(0)).toBe("0");
  });

  it("rounds summary figures to two decimals without flattening small values", () => {
    expect(formatReadable(4793.4879)).toBe("4,793.49");
    expect(formatReadable(19.8487)).toBe("19.85");
    expect(formatReadable(12085)).toBe("12,085");
    expect(formatReadable(0.004567)).toBe("0.00457");
    expect(formatReadable(-0.25)).toBe("-0.25");
  });

  it("shows full values in tables and tooltips", () => {
    expect(formatNumber(4851042.44)).toBe("4,851,042.44");
    expect(formatCell(null)).toBe("—");
    expect(formatCell(true)).toBe("true");
    expect(formatCell("Europe")).toBe("Europe");
    expect(formatCell(250.2222)).toBe("250.2222");
  });

  it("formats sizes, durations and relative times", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(20 * 1024 * 1024)).toBe("20.0 MB");
    expect(formatDuration(75)).toBe("1m 15s");
    const now = Date.parse("2026-11-14T12:00:00Z");
    expect(formatRelative("2026-11-14T11:59:40Z", now)).toBe("just now");
    expect(formatRelative("2026-11-14T11:30:00Z", now)).toBe("30 min ago");
    expect(formatRelative("2026-11-13T12:00:00Z", now)).toBe("1 day ago");
  });
});
