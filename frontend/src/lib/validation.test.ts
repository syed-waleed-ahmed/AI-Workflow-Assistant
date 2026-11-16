import { describe, expect, it } from "vitest";
import {
  loginSchema,
  newPasswordSchema,
  questionSchema,
  registerSchema,
  safeNextPath,
} from "./validation";

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
