import { CalendarTimeError } from "./calendar-time-error";
import { expandRecurringEvents } from "@musubi/calendar";
import type { Event } from "@musubi/types";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useFederatedWorkspace } from "./federated-workspace";
import { parseDateKey } from "./calendar-math";
import { viewDefinition, type CalendarViewId } from "./view-registry";
import {
  getCalendars,
  getEvents,
  getPages,
  getSettings,
} from "~/api/resources";
import { getServerOrigin, queryKeys } from "~/api/query-keys";

export function getVisibleMonthRange(date: string) {
  return viewDefinition("month").range(parseDateKey(date));
}

export function getWorkspaceRange(date: string, view: CalendarViewId) {
  return viewDefinition(view).range(parseDateKey(date));
}

// Expand recurrence for one range/view. Shared so home and federated events go
// through identical logic — a federated event must render like any other.
export function expandForView(
  activeEvents: Event[],
  range: { end: Date; start: Date },
  view: CalendarViewId,
  consumerTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone,
) {
  try {
    const { expandsRecurringOnly } = viewDefinition(view);
    const recurringEvents = expandRecurringEvents(
      activeEvents,
      range.start,
      new Date(range.end.getTime() - 1),
      { consumerTimeZone, includeAllNonRecurring: expandsRecurringOnly },
    );

    return recurringEvents.filter((event) => !event.isCanceled);
  } catch (cause) {
    throw new CalendarTimeError("calendar", cause);
  }
}

export function useWorkspaceQueries(
  date: string,
  userId: string,
  view: CalendarViewId,
) {
  const enabled = typeof window !== "undefined";
  const consumerTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const origin = getServerOrigin();
  // Memoized so downstream memos (and the event query key) see a stable object.
  const range = useMemo(() => getWorkspaceRange(date, view), [date, view]);
  const calendars = useQuery({
    enabled,
    queryFn: ({ signal }) => getCalendars(signal),
    queryKey: queryKeys.calendars(origin, userId),
  });
  const settings = useQuery({
    enabled,
    queryFn: ({ signal }) => getSettings(signal),
    queryKey: queryKeys.settings(origin, userId),
    // A restored pre-mutation snapshot must not resurrect onboarding online.
    staleTime: 0,
  });
  const pages = useQuery({
    enabled,
    queryFn: ({ signal }) => getPages(signal),
    queryKey: queryKeys.pages(origin, userId),
  });
  const events = useQuery({
    enabled,
    // Changing date or view changes the key. Without this the query is pending
    // again and the workspace is replaced by a loading screen — losing the
    // calendar, the focused element and the scroll position on every step
    // through the year. The stale range stays on screen, marked as refreshing,
    // until the new one arrives.
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) =>
      getEvents(view === "agenda" ? undefined : range, signal),
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
      const activeEvents = response.events.filter((event) => !event.isCanceled);

      return {
        ...response,
        baseEvents: activeEvents,
        events: expandForView(response.events, range, view, consumerTimeZone),
      };
    },
  });
  // Calendars on other Musubi servers. Kept as its own query so an unreachable
  // server degrades to a status row instead of failing the whole workspace.
  const federated = useFederatedWorkspace(userId);

  const mergedCalendars = useMemo(
    () => [...(calendars.data ?? []), ...(federated.data?.calendars ?? [])],
    [calendars.data, federated.data],
  );
  const merged = useMemo(() => {
    const home = events.data;
    const remote = federated.data?.events ?? [];
    if (!home || remote.length === 0) return { data: home, error: undefined };
    try {
      return {
        data: {
          ...home,
          baseEvents: [
            ...home.baseEvents,
            ...remote.filter((event) => !event.isCanceled),
          ],
          events: [
            ...home.events,
            ...expandForView(remote, range, view, consumerTimeZone),
          ],
        },
        error: undefined,
      };
    } catch (cause) {
      return {
        data: undefined,
        error:
          cause instanceof CalendarTimeError
            ? cause
            : new CalendarTimeError("calendar", cause),
      };
    }
  }, [events.data, federated.data, range, view, consumerTimeZone]);

  return {
    calendars,
    events,
    federated,
    mergedCalendars,
    mergedEvents: merged.data,
    expansionError: merged.error,
    pages,
    range,
    settings,
  };
}
