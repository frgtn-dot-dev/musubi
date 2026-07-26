import type { Event, Settings } from "@musubi/types";
import { toDateKey } from "./date-key";

const MONDAY_WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const SUNDAY_WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function getWeekdayLabels(weekStartsOn: Settings["weekStartsOn"]) {
  return weekStartsOn === "sunday" ? SUNDAY_WEEKDAYS : MONDAY_WEEKDAYS;
}

export function parseDateKey(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year ?? 0, (month ?? 1) - 1, day ?? 1);
}

export function addMonths(date: Date, amount: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1);
}

export function addDays(date: Date, amount: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + amount);
}

function getEventDay(date: Date, isAllDay: boolean): Date {
  return isAllDay
    ? new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
    : date;
}

export function getMonthGrid(
  anchor: Date,
  weekStartsOn: Settings["weekStartsOn"] = "monday",
): Date[] {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const startOffset =
    weekStartsOn === "sunday" ? first.getDay() : (first.getDay() + 6) % 7;
  const gridStart = addDays(first, -startOffset);

  return Array.from({ length: 42 }, (_, index) => addDays(gridStart, index));
}

export function getMonthLabel(anchor: Date): string {
  return new Intl.DateTimeFormat("en", {
    month: "long",
    year: "numeric",
  }).format(anchor);
}

export function getLongDateLabel(date: Date): string {
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "long",
    weekday: "long",
    year: "numeric",
  }).format(date);
}

function timeFormatter(timeFormat: Settings["timeFormat"]) {
  return new Intl.DateTimeFormat("en", {
    hour: "2-digit",
    hour12: timeFormat === "12h",
    minute: "2-digit",
  });
}

export function getEventTimeLabel(
  event: Event,
  timeFormat: Settings["timeFormat"] = "24h",
): string {
  if (event.isAllDay) {
    return "All day";
  }

  return timeFormatter(timeFormat).format(event.start);
}

export function getEventRangeLabel(
  event: Event,
  timeFormat: Settings["timeFormat"] = "24h",
): string {
  if (event.isAllDay) {
    return "All day";
  }

  const formatter = timeFormatter(timeFormat);

  return `${formatter.format(event.start)} – ${formatter.format(event.end)}`;
}

export function getEventDateLabel(event: Event): string {
  if (!event.isAllDay) {
    return getLongDateLabel(event.start);
  }

  const start = getEventDay(event.start, true);
  const exclusiveEnd = getEventDay(event.end, true);
  const lastDay =
    exclusiveEnd > start ? addDays(exclusiveEnd, -1) : start;
  const startLabel = getLongDateLabel(start);

  return toDateKey(lastDay) === toDateKey(start)
    ? startLabel
    : `${startLabel} – ${getLongDateLabel(lastDay)}`;
}

export type EventDaySegment = {
  continuesAfter: boolean;
  continuesBefore: boolean;
  event: Event;
};

export function bucketEventsByDay(
  events: Event[],
  rangeStart?: Date,
  rangeEndExclusive?: Date,
): Map<string, EventDaySegment[]> {
  const buckets = new Map<string, EventDaySegment[]>();
  const firstVisibleKey = rangeStart ? toDateKey(rangeStart) : undefined;
  const endVisibleKey = rangeEndExclusive
    ? toDateKey(rangeEndExclusive)
    : undefined;

  function addSegment(key: string, segment: EventDaySegment) {
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
      addSegment(toDateKey(event.start), {
        continuesAfter: false,
        continuesBefore: false,
        event,
      });
      continue;
    }

    const start = getEventDay(event.start, true);
    const parsedEnd = getEventDay(event.end, true);
    const exclusiveEnd = parsedEnd > start ? parsedEnd : addDays(start, 1);
    const lastDay = addDays(exclusiveEnd, -1);

    for (
      let cursor = start;
      cursor < exclusiveEnd;
      cursor = addDays(cursor, 1)
    ) {
      addSegment(toDateKey(cursor), {
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
