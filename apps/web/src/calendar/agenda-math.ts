import type { Event } from "@musubi/types";
import {
  addDays,
  dayKey,
  eventDayKey,
  startOfDay,
} from "@musubi/calendar/layout";

export const AGENDA_WINDOW_DAYS = 28;

export function getAgendaRange(anchor: Date) {
  const start = startOfDay(anchor);

  return {
    end: addDays(start, AGENDA_WINDOW_DAYS),
    start,
  };
}

export function getAgendaDays(start: Date, endExclusive: Date): Date[] {
  const days: Date[] = [];

  for (
    let cursor = startOfDay(start);
    cursor < endExclusive;
    cursor = addDays(cursor, 1)
  ) {
    days.push(cursor);
  }

  return days;
}

export function getAgendaRangeLabel(
  start: Date,
  endExclusive: Date,
): string {
  const end = addDays(endExclusive, -1);
  const startMonth = new Intl.DateTimeFormat("en", {
    month: "short",
  }).format(start);
  const endMonth = new Intl.DateTimeFormat("en", {
    month: "short",
  }).format(end);

  if (start.getFullYear() !== end.getFullYear()) {
    return `${startMonth} ${start.getDate()}, ${start.getFullYear()} – ${endMonth} ${end.getDate()}, ${end.getFullYear()}`;
  }

  if (start.getMonth() === end.getMonth()) {
    return `${startMonth} ${start.getDate()} – ${end.getDate()}, ${end.getFullYear()}`;
  }

  return `${startMonth} ${start.getDate()} – ${endMonth} ${end.getDate()}, ${end.getFullYear()}`;
}

export function getAgendaEventsByDay(
  events: Event[],
  start: Date,
  endExclusive: Date,
): Map<string, Event[]> {
  const buckets = new Map<string, Event[]>();
  const firstDayKey = dayKey(start);
  const endDayKey = dayKey(endExclusive);

  for (const event of events) {
    const eventKey = eventDayKey(event.start, event.isAllDay);

    if (eventKey < firstDayKey || eventKey >= endDayKey) {
      continue;
    }

    const bucket = buckets.get(eventKey);

    if (bucket) {
      bucket.push(event);
    } else {
      buckets.set(eventKey, [event]);
    }
  }

  for (const bucket of buckets.values()) {
    bucket.sort((left, right) => {
      if (left.isAllDay !== right.isAllDay) {
        return left.isAllDay ? -1 : 1;
      }

      const startDifference = left.start.getTime() - right.start.getTime();

      return startDifference || left.title.localeCompare(right.title);
    });
  }

  return buckets;
}
