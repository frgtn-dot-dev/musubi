import { describe, expect, it } from "vitest";
import { toDateKey } from "./date-key";

describe("toDateKey", () => {
  it("keeps the local calendar day instead of converting through UTC", () => {
    expect(toDateKey(new Date(2026, 6, 26, 23, 45))).toBe("2026-07-26");
  });

  it("zero-pads month and day", () => {
    expect(toDateKey(new Date(2026, 0, 4))).toBe("2026-01-04");
  });
});
