import { expandRecurringEvents } from "@musubi/calendar";
import type { Event } from "@musubi/types";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useFederatedWorkspace } from "./federated-workspace";
import { parseDateKey } from "./calendar-math";
import { viewDefinition, type CalendarViewId } from "./view-registry";
import { getCalendars, getEvents, getPages, getSettings } from "~/api/resources";
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
) {
  const { expandsRecurringOnly } = viewDefinition(view);
  const recurringEvents = expandRecurringEvents(
    expandsRecurringOnly
      ? activeEvents.filter((event) => event.recurrence)
      : activeEvents,
    range.start,
    new Date(range.end.getTime() - 1),
  );

  return expandsRecurringOnly
    ? [
        ...activeEvents.filter((event) => !event.recurrence),
        ...recurringEvents,
      ]
    : recurringEvents;
}

export function useWorkspaceQueries(
  date: string,
  userId: string,
  view: CalendarViewId,
) {
  const enabled = typeof window !== "undefined";
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
      const activeEvents = response.events.filter(
        (event) => !event.isCanceled,
      );

      return {
        ...response,
        baseEvents: activeEvents,
        events: expandForView(activeEvents, range, view),
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
  const mergedEvents = useMemo(() => {
    const home = events.data;
    const remote = federated.data?.events ?? [];
    if (!home) return undefined;
    if (remote.length === 0) return home;

    return {
      ...home,
      baseEvents: [...home.baseEvents, ...remote],
      events: [...home.events, ...expandForView(remote, range, view)],
    };
  }, [events.data, federated.data, range, view]);

  return {
    calendars,
    events,
    federated,
    mergedCalendars,
    mergedEvents,
    pages,
    range,
    settings,
  };
}
