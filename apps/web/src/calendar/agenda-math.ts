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

export function getAgendaLabel(anchor: Date): string {
  return `From ${new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(anchor)}`;
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
