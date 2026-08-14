import { describe, expect, it } from "vitest";
import { getReadableEventTextColor } from "./event-color";

describe("event color contrast", () => {
  it("uses dark text on light event colors", () => {
    expect(getReadableEventTextColor("#d4a574")).toBe("#000");
    expect(getReadableEventTextColor("#abc")).toBe("#000");
  });

  it("uses light text on dark event colors", () => {
    expect(getReadableEventTextColor("#24324a")).toBe("#fff");
  });

  it("falls back to the default event color for invalid input", () => {
    expect(getReadableEventTextColor("not-a-color")).toBe("#000");
  });
});
