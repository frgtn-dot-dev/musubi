import type { ICalendarEventBase } from "../interfaces";
import { assignOverlapColumns } from "./overlaps";
import { startOfDay } from "./ranges";

export type DaySegment<T extends ICalendarEventBase> = {
  col: number;
  cols: number;
  endMin: number;
  event: T;
  startMin: number;
};

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

// Timed events clipped to one local day before overlap columns are assigned.
export function getDaySegments<T extends ICalendarEventBase>(
  dayEvents: T[],
  day: Date,
): DaySegment<T>[] {
  const dayStart = startOfDay(day).getTime();
  const segments: DaySegment<T>[] = [];

  for (const event of dayEvents) {
    if (event.isAllDay) {
      continue;
    }

    const startMin = clamp(
      (event.start.getTime() - dayStart) / 60_000,
      0,
      24 * 60,
    );
    const endMin = clamp(
      (Math.max(
        event.end.getTime(),
        event.start.getTime() + 60_000,
      ) -
        dayStart) /
        60_000,
      0,
      24 * 60,
    );

    if (endMin <= startMin) {
      continue;
    }

    segments.push({
      col: 0,
      cols: 1,
      endMin,
      event,
      startMin,
    });
  }

  return assignOverlapColumns(segments);
}
