import { describe, expect, it } from "vitest";
import {
  addMonths,
  getMonthGrid,
  getMonthLabel,
  parseDateKey,
} from "./calendar-math";
import { toDateKey } from "./date-key";

describe("calendar month math", () => {
  it("builds a six-week Monday-first grid", () => {
    const grid = getMonthGrid(parseDateKey("2026-07-26"));

    expect(grid).toHaveLength(42);
    expect(toDateKey(grid[0]!)).toBe("2026-06-29");
    expect(toDateKey(grid[41]!)).toBe("2026-08-09");
  });

  it("moves between calendar months without day overflow", () => {
    expect(toDateKey(addMonths(parseDateKey("2026-07-31"), 1))).toBe(
      "2026-08-01",
    );
  });

  it("formats the visible month for the toolbar", () => {
    expect(getMonthLabel(parseDateKey("2026-07-26"))).toBe("July 2026");
  });
});
