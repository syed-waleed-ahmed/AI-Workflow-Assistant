import { describe, expect, it } from "vitest";
import {
  formatBytes,
  formatCell,
  formatCompact,
  formatDuration,
  formatNumber,
  formatReadable,
  formatRelative,
} from "./format";

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
