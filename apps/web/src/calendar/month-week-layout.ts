import {
  dayKey,
  eventDayKeys,
  getAllDaySpans,
} from "@musubi/calendar/layout";
import type { Event } from "@musubi/types";

export type MonthBar = {
  /** Runs on past the last column of this week. */
  continuesAfter: boolean;
  /** Began before the first column of this week. */
  continuesBefore: boolean;
  endCol: number;
  event: Event;
  lane: number;
  startCol: number;
};

export type MonthDayPlacement = {
  /** How many of this day's blocks did not fit. */
  overflow: number;
  /** Which line each timed event took, by event id. */
  rowOf: Map<string, number>;
  /** The line after the last visible one — where "+N more" belongs. */
  rowCapacity: number;
};

export type MonthWeekLayout = {
  /** All-day bars this week, already dropped if they cannot be shown. */
  bars: MonthBar[];
  days: MonthDayPlacement[];
  /** Lines the bars claim, so a cell can leave room for them. */
  laneCount: number;
};

/**
 * One week of the month grid, laid out.
 *
 * An all-day event is **one bar per week**, not a chip in every cell it touches.
 * The month grid only breaks it where the week does, and the two ends of that
 * break stay square so the eye carries on into the next row.
 *
 * Timed events keep their own cell and fill the lines the bars leave free — a
 * day a bar does not reach must not hold an empty gap open for it.
 */
export function layOutMonthWeek({
  capacity,
  days,
  events,
  laneOffset = 0,
  timedByDay,
}: {
  /** Lines a cell can show, measured from the rendered grid. */
  capacity: number;
  days: Date[];
  events: Event[];
  /** Lines claimed above everything else, today only ever the draft. */
  laneOffset?: number;
  /** This week's timed events, in the order each day wants them. */
  timedByDay: Event[][];
}): MonthWeekLayout {
  const spans = getAllDaySpans(events, days);
  const firstKey = dayKey(days[0]!);
  const lastKey = dayKey(days[days.length - 1]!);

  const bars: MonthBar[] = spans.map((span) => {
    // The days the event really covers, by the same reckoning the buckets use:
    // an all-day boundary is a calendar date at UTC midnight, not a local one.
    const keys = eventDayKeys(span.event);

    return {
    continuesAfter: keys[keys.length - 1]! > lastKey,
    continuesBefore: keys[0]! < firstKey,
    endCol: span.endCol,
    event: span.event,
    lane: span.lane + laneOffset,
    startCol: span.startCol,
    };
  });

  // Which lines are spoken for on each day, so the timed events flow around
  // them rather than under them.
  const reserved = days.map(() => new Set<number>());
  for (const bar of bars) {
    for (let column = bar.startCol; column <= bar.endCol; column += 1) {
      reserved[column]?.add(bar.lane);
    }
  }

  const days_ = days.map((_, index) => {
    const taken = reserved[index]!;
    const rowOf = new Map<string, number>();
    let cursor = laneOffset;

    for (const event of timedByDay[index] ?? []) {
      while (taken.has(cursor)) cursor += 1;
      taken.add(cursor);
      rowOf.set(event.id!, cursor);
      cursor += 1;
    }

    const usedRows = [...taken].reduce(
      (rows, lane) => Math.max(rows, lane + 1),
      laneOffset,
    );
    // One measured line goes to "+N more" as soon as everything cannot fit.
    const rowCapacity =
      usedRows > capacity ? Math.max(0, capacity - 1) : capacity;
    const overflow = [...taken].filter((lane) => lane >= rowCapacity).length;

    return { overflow, rowCapacity, rowOf };
  });

  return {
    // A bar is one element across several cells, so it can only be shown if it
    // fits in every day it crosses.
    bars: bars.filter((bar) =>
      days_.every(
        (day, index) =>
          index < bar.startCol ||
          index > bar.endCol ||
          bar.lane < day.rowCapacity,
      ),
    ),
    days: days_,
    laneCount: bars.reduce((lanes, bar) => Math.max(lanes, bar.lane + 1), 0),
  };
}
