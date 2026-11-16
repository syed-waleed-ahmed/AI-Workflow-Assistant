import { describe, expect, it } from "vitest";
import { resolveRedirect } from "./route-guard";

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
    expect(resolveRedirect({ pathname: "/app/analyses", search: "", hasSession: true })).toBeNull();
    expect(resolveRedirect({ pathname: "/login", search: "", hasSession: false })).toBeNull();
    expect(resolveRedirect({ pathname: "/application", search: "", hasSession: false })).toBeNull();
  });
});
