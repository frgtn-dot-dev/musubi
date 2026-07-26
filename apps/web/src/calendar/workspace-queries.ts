import { expandRecurringEvents } from "@musubi/calendar";
import {
  getMonthGridRange,
  startOfDay,
} from "@musubi/calendar/layout";
import { useQuery } from "@tanstack/react-query";
import { getAgendaRecurrenceEnd } from "./agenda-math";
import { parseDateKey } from "./calendar-math";
import { getTimeGridQueryRange } from "./time-grid-math";
import type { CalendarViewId } from "./view-registry";
import { getCalendars, getEvents, getSettings } from "~/api/resources";
import { getServerOrigin, queryKeys } from "~/api/query-keys";

export function getVisibleMonthRange(date: string) {
  const range = getMonthGridRange(parseDateKey(date), "monday", 1);

  return {
    // One day of padding covers both Sunday- and Monday-first user settings
    // without waiting for settings before the three initial reads can start.
    end: range.endExclusive,
    start: range.start,
  };
}

export function getWorkspaceRange(date: string, view: CalendarViewId) {
  const anchor = parseDateKey(date);

  if (view === "agenda") {
    const start = startOfDay(anchor);

    return { end: getAgendaRecurrenceEnd(start), start };
  }

  if (view === "day" || view === "week") {
    return getTimeGridQueryRange(anchor, view);
  }

  return getVisibleMonthRange(date);
}

export function useWorkspaceQueries(
  date: string,
  userId: string,
  view: CalendarViewId,
) {
  const enabled = typeof window !== "undefined";
  const origin = getServerOrigin();
  const range = getWorkspaceRange(date, view);
  const calendars = useQuery({
    enabled,
    queryFn: ({ signal }) => getCalendars(signal),
    queryKey: queryKeys.calendars(origin, userId),
  });
  const settings = useQuery({
    enabled,
    queryFn: ({ signal }) => getSettings(signal),
    queryKey: queryKeys.settings(origin, userId),
  });
  const events = useQuery({
    enabled,
    queryFn: ({ signal }) => getEvents(signal),
    queryKey: queryKeys.eventRange({
      // The current endpoint is user-scoped rather than calendar-filtered.
      // This sentinel is replaced by exact IDs when the range endpoint lands.
      calendarIds: ["@all"],
      end: range.end,
      filterFingerprint: view,
      serverOrigin: origin,
      start: range.start,
      userId,
    }),
    select: (response) => {
      const activeEvents = response.events.filter(
        (event) => !event.isCanceled,
      );
      const recurringEvents = expandRecurringEvents(
        view === "agenda"
          ? activeEvents.filter((event) => event.recurrence)
          : activeEvents,
        range.start,
        new Date(range.end.getTime() - 1),
      );

      return {
        ...response,
        events:
          view === "agenda"
            ? [
                ...activeEvents.filter((event) => !event.recurrence),
                ...recurringEvents,
              ]
            : recurringEvents,
      };
    },
  });

  return {
    calendars,
    events,
    range,
    settings,
  };
}
