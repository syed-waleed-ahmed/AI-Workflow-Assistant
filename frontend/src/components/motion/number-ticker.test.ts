import { describe, expect, it } from "vitest";
import { parseFigure } from "./number-ticker";

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
