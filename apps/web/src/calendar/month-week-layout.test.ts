import { describe, expect, it } from "vitest";
import type { Event } from "@musubi/types";
import { layOutMonthWeek } from "./month-week-layout";

const WEEK = Array.from(
  { length: 7 },
  (_, index) => new Date(2026, 6, 20 + index),
);

/** All-day boundaries are calendar dates at UTC midnight, end inclusive. */
function utc(day: number) {
  return new Date(Date.UTC(2026, 6, day));
}

function allDay(id: string, from: number, to: number): Event {
  return {
    calendars: ["personal"],
    creatorID: "alex",
    end: utc(to),
    hasAttendees: false,
    id,
    isAllDay: true,
    start: utc(from),
    title: id,
  } as Event;
}

function timed(id: string, day: number): Event {
  return {
    calendars: ["personal"],
    creatorID: "alex",
    end: new Date(2026, 6, day, 11),
    hasAttendees: false,
    id,
    isAllDay: false,
    start: new Date(2026, 6, day, 10),
    title: id,
  } as Event;
}

describe("layOutMonthWeek", () => {
  it("gives a multi-day event one bar with one lane", () => {
    const layout = layOutMonthWeek({
      capacity: 3,
      days: WEEK,
      events: [allDay("holiday", 21, 23)],
      timedByDay: WEEK.map(() => []),
    });

    expect(layout.bars).toHaveLength(1);
    expect(layout.bars[0]).toMatchObject({
      continuesAfter: false,
      continuesBefore: false,
      endCol: 3,
      lane: 0,
      startCol: 1,
    });
  });

  it("marks the ends that carry on past the week", () => {
    const layout = layOutMonthWeek({
      capacity: 3,
      days: WEEK,
      events: [allDay("long", 18, 28)],
      timedByDay: WEEK.map(() => []),
    });

    expect(layout.bars[0]).toMatchObject({
      continuesAfter: true,
      continuesBefore: true,
      endCol: 6,
      startCol: 0,
    });
  });

  it("lets a day the bar misses use that line", () => {
    const layout = layOutMonthWeek({
      capacity: 3,
      days: WEEK,
      // The bar covers Tue–Thu, so Mon's meeting takes the top line and
      // Tuesday's has to start below the bar.
      events: [allDay("holiday", 21, 23), timed("monday", 20), timed("tuesday", 21)],
      timedByDay: [[timed("monday", 20)], [timed("tuesday", 21)], [], [], [], [], []],
    });

    expect(layout.days[0]!.rowOf.get("monday")).toBe(0);
    expect(layout.days[1]!.rowOf.get("tuesday")).toBe(1);
  });

  it("drops a bar whose line no longer fits", () => {
    const layout = layOutMonthWeek({
      capacity: 2,
      days: WEEK,
      // Three bars overlap, so the third one needs a third line the cell does
      // not have. Drawn on some days and missing on others it would read as
      // several events, so it is not drawn at all.
      events: [
        allDay("first", 20, 23),
        allDay("second", 21, 24),
        allDay("third", 22, 25),
      ],
      timedByDay: WEEK.map(() => []),
    });

    expect(layout.bars.map((bar) => bar.event.id)).toEqual(["first"]);
    expect(layout.days[2]!.overflow).toBe(2);
  });

  it("keeps the top line for a draft", () => {
    const layout = layOutMonthWeek({
      capacity: 3,
      days: WEEK,
      events: [allDay("holiday", 21, 23)],
      laneOffset: 1,
      timedByDay: WEEK.map(() => []),
    });

    expect(layout.bars[0]!.lane).toBe(1);
  });
});
