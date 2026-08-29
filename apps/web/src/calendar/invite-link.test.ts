import { describe, expect, it } from "vitest";
import { parseInviteLink } from "@musubi/types";

const HOME = "https://home.example";
const TOKEN = "0f9c1d2e3a4b5c6d7e8f9a0b1c2d3e4f"; // gitleaks:allow -- deterministic test token

describe("parseInviteLink", () => {
  it("treats a link from this server as a native join", () => {
    expect(parseInviteLink(`${HOME}/invite/${TOKEN}`, HOME)).toEqual({
      token: TOKEN,
    });
  });

  it("keeps the origin for another server", () => {
    expect(
      parseInviteLink(`https://friends.example/invite/${TOKEN}`, HOME),
    ).toEqual({ server: "https://friends.example", token: TOKEN });
  });

  it("accepts a bare token", () => {
    expect(parseInviteLink(`  ${TOKEN}  `, HOME)).toEqual({ token: TOKEN });
  });

  it("ignores the path shape and query", () => {
    expect(
      parseInviteLink(`https://friends.example/join/${TOKEN}?x=1`, HOME),
    ).toEqual({ server: "https://friends.example", token: TOKEN });
  });

  it("keeps a non-default port as part of the origin", () => {
    expect(
      parseInviteLink(`http://127.0.0.1:7532/invite/${TOKEN}`, HOME),
    ).toEqual({ server: "http://127.0.0.1:7532", token: TOKEN });
  });

  it("rejects anything that is not an invite", () => {
    for (const value of [
      "",
      "   ",
      "not a link",
      "https://friends.example/invite/short",
      "https://friends.example/invite/not-hex-zzzzzzzzzzzzzzzzzzzz",
      "https://friends.example/",
      `javascript:alert(1)/${TOKEN}`,
      `musubi://invite/${TOKEN}`,
    ]) {
      expect(parseInviteLink(value, HOME), value).toBeNull();
    }
  });
});
