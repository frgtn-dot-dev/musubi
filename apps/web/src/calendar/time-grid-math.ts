import type { Settings } from "@musubi/types";
import {
  addDays,
  startOfDay,
  startOfWeek,
} from "@musubi/calendar/layout";

export type TimeGridViewId = "day" | "week";

export function getTimeGridDays(
  anchor: Date,
  view: TimeGridViewId,
  weekStartsOn: Settings["weekStartsOn"],
  // A page can hide the weekend to get a five-column working week.
  { includeWeekend = true }: { includeWeekend?: boolean } = {},
): Date[] {
  const start =
    view === "day"
      ? startOfDay(anchor)
      : startOfWeek(anchor, weekStartsOn);
  const length = view === "day" ? 1 : 7;
  const days = Array.from({ length }, (_, index) => addDays(start, index));

  // Filtered by actual weekday, so it holds for both week starts. A single day
  // is never dropped — the user navigated to it deliberately.
  return includeWeekend || view === "day"
    ? days
    : days.filter((day) => day.getDay() !== 0 && day.getDay() !== 6);
}

export function getTimeGridQueryRange(
  anchor: Date,
  view: TimeGridViewId,
) {
  if (view === "day") {
    const start = startOfDay(anchor);

    return { end: addDays(start, 1), start };
  }

  const mondayStart = startOfWeek(anchor, "monday");
  const sundayStart = startOfWeek(anchor, "sunday");
  const start =
    mondayStart.getTime() < sundayStart.getTime()
      ? mondayStart
      : sundayStart;
  const latestStart =
    mondayStart.getTime() > sundayStart.getTime()
      ? mondayStart
      : sundayStart;

  return {
    end: addDays(latestStart, 7),
    start,
  };
}

export function getTimeGridLabel(
  days: Date[],
  view: TimeGridViewId,
): string {
  const first = days[0];
  const last = days[days.length - 1];

  if (!first || !last) {
    return "";
  }

  if (view === "day") {
    return new Intl.DateTimeFormat("en", {
      day: "numeric",
      month: "long",
      weekday: "long",
      year: "numeric",
    }).format(first);
  }

  const firstMonth = new Intl.DateTimeFormat("en", {
    month: "short",
  }).format(first);
  const lastMonth = new Intl.DateTimeFormat("en", {
    month: "short",
  }).format(last);

  if (first.getFullYear() !== last.getFullYear()) {
    return `${firstMonth} ${first.getDate()}, ${first.getFullYear()} – ${lastMonth} ${last.getDate()}, ${last.getFullYear()}`;
  }

  if (first.getMonth() === last.getMonth()) {
    return `${firstMonth} ${first.getDate()} – ${last.getDate()}, ${last.getFullYear()}`;
  }

  return `${firstMonth} ${first.getDate()} – ${lastMonth} ${last.getDate()}, ${last.getFullYear()}`;
}
