import type { Event } from "@musubi/types";
import {
  eventDayDate,
  eventDayKey,
  isSameDay,
  startOfDay,
} from "@musubi/calendar/layout";

export const AGENDA_GROUP_PAGE = 14;
export const AGENDA_RECURRENCE_HORIZON_YEARS = 2;

export type AgendaGroup = {
  date: Date;
  items: Event[];
  key: string;
};

export function getAgendaStart(anchor: Date, now = new Date()): Date {
  return isSameDay(anchor, now) ? now : startOfDay(anchor);
}

export function getAgendaRecurrenceEnd(start: Date): Date {
  const end = new Date(start);
  end.setFullYear(end.getFullYear() + AGENDA_RECURRENCE_HORIZON_YEARS);
  return end;
}

export function getAgendaLabel(
  anchor: Date,
  { compact = false }: { compact?: boolean } = {},
): string {
  return `From ${new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    ...(compact ? {} : { year: "numeric" }),
  }).format(anchor)}`;
}

/**
 * The name a day answers to before its date does.
 *
 * An agenda is scanned for "when", so the two days everyone thinks of by name get
 * their name; the rest stay dates, because "Thursday" three weeks out tells you
 * nothing.
 */
export function relativeDayName(
  date: Date,
  now = new Date(),
): string | undefined {
  if (isSameDay(date, now)) return "Today";
  const tomorrow = new Date(startOfDay(now));
  tomorrow.setDate(tomorrow.getDate() + 1);
  return isSameDay(date, tomorrow) ? "Tomorrow" : undefined;
}

/**
 * How many days with nothing on them sit between two agenda groups.
 *
 * The list only renders days that have events, so without this a jump from the
 * 27th to the 3rd looks like the 3rd comes next. Saying how much time is free is
 * half of what an agenda is for.
 */
export function freeDaysBetween(previous: Date, next: Date): number {
  const from = startOfDay(previous).getTime();
  const to = startOfDay(next).getTime();
  const days = Math.round((to - from) / 86_400_000) - 1;
  return Math.max(0, days);
}

export function getAgendaGroups(
  events: Event[],
  anchor: Date,
  now = new Date(),
): AgendaGroup[] {
  const agendaStart = getAgendaStart(anchor, now);
  const firstDayKey = eventDayKey(agendaStart, false);
  const sorted = events
    .filter((event) => {
      if (event.isAllDay) {
        return eventDayKey(event.start, true) >= firstDayKey;
      }

      return event.start > agendaStart;
    })
    .toSorted(
      (left, right) =>
        left.start.getTime() - right.start.getTime() ||
        Number(right.isAllDay) - Number(left.isAllDay) ||
        left.title.localeCompare(right.title),
    );
  const groups: AgendaGroup[] = [];

  for (const event of sorted) {
    const key = eventDayKey(event.start, event.isAllDay);
    const current = groups[groups.length - 1];

    if (current?.key === key) {
      current.items.push(event);
    } else {
      groups.push({
        date: eventDayDate(event.start, event.isAllDay),
        items: [event],
        key,
      });
    }
  }

  return groups;
}
