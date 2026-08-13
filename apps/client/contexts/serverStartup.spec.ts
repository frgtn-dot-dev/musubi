import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./ServerContext.tsx", import.meta.url), "utf8");

describe("server startup", () => {
  it("does not create an auth client before SecureStore resolves", () => {
    expect(source).not.toMatch(/useState[^\n]*createClient\(defaultUrl\)/);
    expect(source.indexOf("getItemAsync(\"API_URL\")"))
      .toBeLessThan(source.indexOf("createClient(url)"));
    expect(source).toContain("if (!server) return null");
  });
});
