import type { ICalendarEventBase } from "../interfaces";
import { eventDayKeys } from "./day-buckets";
import { dayKey } from "./ranges";

export type AllDaySpan<T extends ICalendarEventBase> = {
  endCol: number;
  event: T;
  lane: number;
  startCol: number;
};

// Continuous all-day bars within one visible row. Events that cross a row edge
// are clipped to that row and receive a lane independently in the next row.
export function getAllDaySpans<T extends ICalendarEventBase>(
  events: T[],
  days: Date[],
): AllDaySpan<T>[] {
  const keys = days.map(dayKey);
  const spans: AllDaySpan<T>[] = [];
  const seen = new Set<string>();

  for (const event of events) {
    if (!event.isAllDay || !event.id || seen.has(event.id)) {
      continue;
    }

    const eventKeys = new Set(eventDayKeys(event));
    let startColumn = -1;
    let endColumn = -1;

    keys.forEach((key, index) => {
      if (eventKeys.has(key)) {
        if (startColumn < 0) {
          startColumn = index;
        }

        endColumn = index;
      }
    });

    if (startColumn < 0) {
      continue;
    }

    seen.add(event.id);
    spans.push({
      endCol: endColumn,
      event,
      lane: 0,
      startCol: startColumn,
    });
  }

  spans.sort(
    (left, right) =>
      left.startCol - right.startCol || right.endCol - left.endCol,
  );

  const laneEnds: number[] = [];

  for (const span of spans) {
    let lane = laneEnds.findIndex((end) => end < span.startCol);

    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(-1);
    }

    laneEnds[lane] = span.endCol;
    span.lane = lane;
  }

  return spans;
}
