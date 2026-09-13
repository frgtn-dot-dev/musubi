import { describe, expect, it } from "vitest";
import { authCookiePrefixes } from "./authCookiePrefixes";

describe("QA auth cookie prefixes", () => {
  it("preserves deployed authentication in release builds even with a stale QA env", () => {
    expect(authCookiePrefixes(false, "musubi-ui-qa")).toEqual(["better-auth"]);
    expect(authCookiePrefixes(false, "invalid;cookie")).toEqual(["better-auth"]);
  });
  it("accepts isolated QA and normal servers in a development client", () => {
    expect(authCookiePrefixes(true, " musubi-ui-qa ")).toEqual(["better-auth", "musubi-ui-qa"]);
    expect(authCookiePrefixes(true)).toEqual(["better-auth"]);
    expect(authCookiePrefixes(true, " ")).toEqual(["better-auth"]);
    expect(authCookiePrefixes(true, "better-auth")).toEqual(["better-auth"]);
  });
  it("rejects malformed or unbounded prefixes", () => {
    for (const value of ["x".repeat(65), "qa.cookie", "qa;cookie", "qa cookie"]) {
      expect(() => authCookiePrefixes(true, value)).toThrow("EXPO_PUBLIC_DEV_AUTH_COOKIE_PREFIX");
    }
  });
});
