import type { Event } from "@musubi/types";
import { toDateKey } from "./date-key";

export const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

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

export function getMonthGrid(anchor: Date): Date[] {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const mondayOffset = (first.getDay() + 6) % 7;
  const gridStart = addDays(first, -mondayOffset);

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

export function getEventTimeLabel(event: Event): string {
  if (event.isAllDay) {
    return "All day";
  }

  return new Intl.DateTimeFormat("en", {
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
  }).format(event.start);
}

export function getEventRangeLabel(event: Event): string {
  if (event.isAllDay) {
    return "All day";
  }

  const formatter = new Intl.DateTimeFormat("en", {
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
  });

  return `${formatter.format(event.start)} – ${formatter.format(event.end)}`;
}

export function bucketEventsByDay(events: Event[]): Map<string, Event[]> {
  const buckets = new Map<string, Event[]>();

  for (const event of events) {
    const key = toDateKey(event.start);
    const bucket = buckets.get(key);

    if (bucket) {
      bucket.push(event);
    } else {
      buckets.set(key, [event]);
    }
  }

  for (const bucket of buckets.values()) {
    bucket.sort((a, b) => a.start.getTime() - b.start.getTime());
  }

  return buckets;
}
