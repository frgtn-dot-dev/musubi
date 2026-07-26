import { describe, expect, it } from "vitest";
import {
  getTimeGridDays,
  getTimeGridLabel,
  getTimeGridQueryRange,
} from "./time-grid-math";
import { parseDateKey } from "./calendar-math";
import { toDateKey } from "./date-key";

describe("time grid math", () => {
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
