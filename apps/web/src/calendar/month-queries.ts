import { expandRecurringEvents } from "@musubi/calendar";
import { getMonthGridRange } from "@musubi/calendar/layout";
import { useQuery } from "@tanstack/react-query";
import { parseDateKey } from "./calendar-math";
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

export function useMonthQueries(date: string, userId: string) {
  const enabled = typeof window !== "undefined";
  const origin = getServerOrigin();
  const range = getVisibleMonthRange(date);
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
      filterFingerprint: "all",
      serverOrigin: origin,
      start: range.start,
      userId,
    }),
    select: (response) => ({
      ...response,
      events: expandRecurringEvents(
        response.events.filter((event) => !event.isCanceled),
        range.start,
        new Date(range.end.getTime() - 1),
      ),
    }),
  });

  return {
    calendars,
    events,
    range,
    settings,
  };
}
