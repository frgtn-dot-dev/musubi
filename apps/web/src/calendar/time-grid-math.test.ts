import { describe, expect, it } from "vitest";
import {
  getTimeGridDays,
  getTimeGridLabel,
  getTimeGridQueryRange,
  openScrollMinutes,
  overlapPlacement,
} from "./time-grid-math";
import { parseDateKey } from "./calendar-math";
import { toDateKey } from "./date-key";

describe("time grid math", () => {
  it("drops the weekend for a five-column working week", () => {
    const anchor = parseDateKey("2026-07-26"); // a Sunday

    // Filtered by weekday, so it holds for either week start.
    for (const weekStartsOn of ["monday", "sunday"] as const) {
      const days = getTimeGridDays(anchor, "week", weekStartsOn, {
        includeWeekend: false,
      });
      expect(days).toHaveLength(5);
      expect(days.some((day) => day.getDay() === 0 || day.getDay() === 6)).toBe(
        false,
      );
    }

    // A single day the user navigated to is never dropped, weekend or not.
    expect(
      getTimeGridDays(anchor, "day", "monday", { includeWeekend: false }).map(
        toDateKey,
      ),
    ).toEqual(["2026-07-26"]);
  });

  it("builds Day and preference-aware Week columns", () => {
    const anchor = parseDateKey("2026-07-26");

    expect(
      getTimeGridDays(anchor, "day", "monday").map(toDateKey),
    ).toEqual(["2026-07-26"]);
    expect(
      getTimeGridDays(anchor, "week", "monday").map(toDateKey),
    ).toEqual([
      "2026-07-20",
      "2026-07-21",
      "2026-07-22",
      "2026-07-23",
      "2026-07-24",
      "2026-07-25",
      "2026-07-26",
    ]);
    expect(
      getTimeGridDays(anchor, "week", "sunday").map(toDateKey),
    ).toEqual([
      "2026-07-26",
      "2026-07-27",
      "2026-07-28",
      "2026-07-29",
      "2026-07-30",
      "2026-07-31",
      "2026-08-01",
    ]);
  });

  it("queries the union of Sunday- and Monday-first weeks in parallel", () => {
    const range = getTimeGridQueryRange(
      parseDateKey("2026-07-26"),
      "week",
    );

    expect(toDateKey(range.start)).toBe("2026-07-20");
    expect(toDateKey(range.end)).toBe("2026-08-02");
  });

  it("formats Day and cross-month Week toolbar labels", () => {
    const anchor = parseDateKey("2026-07-26");

    expect(
      getTimeGridLabel(
        getTimeGridDays(anchor, "day", "monday"),
        "day",
      ),
    ).toBe("Sunday, July 26, 2026");
    expect(
      getTimeGridLabel(
        getTimeGridDays(anchor, "week", "sunday"),
        "week",
      ),
    ).toBe("Jul 26 – Aug 1, 2026");
  });
});

describe("overlap placement", () => {
  it("gives a single event the whole column", () => {
    expect(overlapPlacement(0, 1)).toEqual({
      left: "0%",
      width: "calc(100% - 3px)",
    });
  });

  it("spreads a block past its lane so the one under it stays readable", () => {
    const first = overlapPlacement(0, 2);
    const second = overlapPlacement(1, 2);

    expect(first.left).toBe("0%");
    expect(second.left).toBe("50%");
    // The first block reaches into the second lane; the second one takes the
    // rest. Neither is left as a sliver, which a fixed-pixel cascade would do.
    expect(first.width).toBe("calc(85% - 3px)");
    expect(second.width).toBe("calc(50% - 3px)");
  });

  it("never spreads past the column's right edge", () => {
    for (const cols of [1, 2, 3, 4, 5, 9]) {
      for (let col = 0; col < cols; col += 1) {
        const { left, width } = overlapPlacement(col, cols);
        const leftPercent = Number.parseFloat(left);
        const widthPercent = Number.parseFloat(width.replace("calc(", ""));
        expect(leftPercent + widthPercent).toBeLessThanOrEqual(100);
      }
    }
  });

  it("stacks deep clusters on the last lane instead of off the column", () => {
    // Past the lane cap the geometry repeats; z-order (the caller's col) still
    // decides what is on top.
    expect(overlapPlacement(4, 9)).toEqual(overlapPlacement(3, 9));
    expect(overlapPlacement(8, 9)).toEqual(overlapPlacement(3, 9));
    expect(overlapPlacement(3, 9).left).toBe("75%");
  });
});

describe("opening scroll position", () => {
  it("opens just before now when today is on screen", () => {
    expect(openScrollMinutes(new Date("2026-07-30T15:20:00"), true)).toBe(
      14 * 60,
    );
  });

  it("never scrolls above the start of the day", () => {
    expect(openScrollMinutes(new Date("2026-07-30T00:30:00"), true)).toBe(0);
  });

  it("falls back to the working day for a range without today", () => {
    expect(openScrollMinutes(new Date("2026-07-30T15:20:00"), false)).toBe(
      7 * 60,
    );
  });
});
