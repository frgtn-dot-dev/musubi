import { describe, expect, it } from "vitest";
import {
  calendarViews,
  isCalendarView,
  viewDefinition,
} from "./view-registry";

const ANCHOR = new Date(2026, 6, 15); // Wednesday, 15 July 2026
const OPTIONS = { compact: false, weekStartsOn: "monday" } as const;

describe("the view registry", () => {
  // Table-driven on purpose: a new view is added by appending a definition, and
  // whatever it is, it has to answer these four questions like every other one.
  // That is the contract `PRD §16.2` asks for before multi-week can be additive.
  it.each(calendarViews.map((view) => [view.id, view] as const))(
    "%s answers the whole contract",
    (_id, view) => {
      expect(view.label.length).toBeGreaterThan(0);

      const range = view.range(ANCHOR);
      expect(range.start.getTime()).toBeLessThan(range.end.getTime());
      // The anchor day itself must be inside the window it asks the server for.
      expect(range.start.getTime()).toBeLessThanOrEqual(ANCHOR.getTime());
      expect(range.end.getTime()).toBeGreaterThan(ANCHOR.getTime());

      expect(view.title(ANCHOR, OPTIONS).length).toBeGreaterThan(0);

      // Arrows move, and they move back. Not to the same *day*: month and
      // agenda paging snaps the anchor to the start of the period, which is
      // deliberate — the pinned invariant is that back never overshoots
      // forward, so ten screens of navigation cannot drift.
      const forward = view.step(ANCHOR, 1);
      const returned = view.step(forward, -1);
      expect(forward.getTime()).toBeGreaterThan(ANCHOR.getTime());
      expect(view.step(ANCHOR, -1).getTime()).toBeLessThan(ANCHOR.getTime());
      expect(returned.getTime()).toBeLessThanOrEqual(forward.getTime());
      // And it lands on the screen you came from, whichever day it picks.
      expect(returned.getMonth()).toBe(ANCHOR.getMonth());
    },
  );

  it("moves by the period it shows", () => {
    const day = viewDefinition("day").step(ANCHOR, 1);
    expect(day.getDate()).toBe(16);

    const week = viewDefinition("week").step(ANCHOR, 1);
    expect(week.getDate()).toBe(22);

    const month = viewDefinition("month").step(ANCHOR, 1);
    expect(month.getMonth()).toBe(7);
  });

  it("keeps the query range free of the week-start setting", () => {
    // The first read starts before settings load, so a week range covers both
    // week starts rather than waiting to find out which one applies.
    const week = viewDefinition("week").range(ANCHOR);
    expect(week.end.getTime() - week.start.getTime()).toBeGreaterThanOrEqual(
      8 * 24 * 60 * 60 * 1_000,
    );
  });

  it("expands everything except on the agenda", () => {
    // The agenda is a forward-looking list: expanding non-recurring events into
    // its two-year horizon would be work for rows nobody scrolls to.
    expect(viewDefinition("agenda").expandsRecurringOnly).toBe(true);
    for (const id of ["day", "week", "month"]) {
      expect(viewDefinition(id).expandsRecurringOnly).toBe(false);
    }
  });

  it("falls back to month for anything it does not know", () => {
    expect(isCalendarView("month")).toBe(true);
    expect(isCalendarView("multi-week")).toBe(false);
    // A stale bookmark or a hand-edited URL lands somewhere real.
    expect(viewDefinition("nonsense").id).toBe("month");
  });
});
