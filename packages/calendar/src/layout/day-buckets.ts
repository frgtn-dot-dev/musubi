import type { ICalendarEventBase } from "../interfaces";
import {
  addDays,
  dayKey,
  eventDayDate,
  eventDayKey,
} from "./ranges";

export type EventDaySegment<T extends ICalendarEventBase> = {
  continuesAfter: boolean;
  continuesBefore: boolean;
  event: T;
};

export function eventDayKeys<T extends ICalendarEventBase>(
  event: T,
  maximumDays = 60,
): string[] {
  const isAllDay = event.isAllDay === true;
  const startKey = eventDayKey(event.start, isAllDay);
  const endMilliseconds = isAllDay
    ? event.end.getTime()
    : Math.max(event.start.getTime(), event.end.getTime() - 1);
  const endKey = eventDayKey(new Date(endMilliseconds), isAllDay);

  if (startKey === endKey) {
    return [startKey];
  }

  const keys: string[] = [];
  let cursor = new Date(`${startKey}T00:00:00`);

  while (dayKey(cursor) <= endKey && keys.length < maximumDays) {
    keys.push(dayKey(cursor));
    cursor = addDays(cursor, 1);
  }

  return keys;
}

export function bucketEventsByDay<T extends ICalendarEventBase>(
  events: T[],
): Map<string, T[]> {
  const buckets = new Map<string, T[]>();

  for (const event of events) {
    for (const key of eventDayKeys(event)) {
      const bucket = buckets.get(key);

      if (bucket) {
        bucket.push(event);
      } else {
        buckets.set(key, [event]);
      }
    }
  }

  for (const bucket of buckets.values()) {
    bucket.sort(
      (left, right) =>
        Number(right.isAllDay === true) - Number(left.isAllDay === true),
    );
  }

  return buckets;
}

// Web Month needs continuation metadata so one all-day event can render as a
// continuous bar across adjacent cells. Timed events remain on their start day.
export function segmentEventsByDay<T extends ICalendarEventBase>(
  events: T[],
  rangeStart?: Date,
  rangeEndExclusive?: Date,
): Map<string, EventDaySegment<T>[]> {
  const buckets = new Map<string, EventDaySegment<T>[]>();
  const firstVisibleKey = rangeStart ? dayKey(rangeStart) : undefined;
  const endVisibleKey = rangeEndExclusive
    ? dayKey(rangeEndExclusive)
    : undefined;

  function addSegment(key: string, segment: EventDaySegment<T>) {
    if (
      (firstVisibleKey && key < firstVisibleKey) ||
      (endVisibleKey && key >= endVisibleKey)
    ) {
      return;
    }

    const bucket = buckets.get(key);

    if (bucket) {
      bucket.push(segment);
    } else {
      buckets.set(key, [segment]);
    }
  }

  for (const event of events) {
    if (!event.isAllDay) {
      addSegment(dayKey(event.start), {
        continuesAfter: false,
        continuesBefore: false,
        event,
      });
      continue;
    }

    const start = eventDayDate(event.start, true);
    const parsedEnd = eventDayDate(event.end, true);
    // Musubi's canonical Event uses an inclusive end calendar date for
    // all-day events. Provider adapters translate their exclusive DTEND/end
    // boundary at the API edge.
    const lastDay = parsedEnd >= start ? parsedEnd : start;
    const exclusiveEnd = addDays(lastDay, 1);

    for (
      let cursor = start;
      cursor < exclusiveEnd;
      cursor = addDays(cursor, 1)
    ) {
      addSegment(dayKey(cursor), {
        continuesAfter: cursor < lastDay,
        continuesBefore: cursor > start,
        event,
      });
    }
  }

  for (const bucket of buckets.values()) {
    bucket.sort((left, right) => {
      if (left.event.isAllDay !== right.event.isAllDay) {
        return left.event.isAllDay ? -1 : 1;
      }

      const startDifference =
        left.event.start.getTime() - right.event.start.getTime();

      if (startDifference !== 0) {
        return startDifference;
      }

      return (
        right.event.end.getTime() -
        right.event.start.getTime() -
        (left.event.end.getTime() - left.event.start.getTime())
      );
    });
  }

  return buckets;
}
