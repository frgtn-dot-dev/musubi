import type { Calendar, Event } from "@musubi/types";

let refreshTail: Promise<unknown> = Promise.resolve();

/** Keep every cache mutation in refresh order, even when callers use separate hooks. */
export function serializeEventRefresh<T>(
  refresh: () => Promise<T>,
): Promise<T> {
  const result = refreshTail.then(refresh, refresh);
  refreshTail = result.catch(() => undefined);
  return result;
}

/** Replace home events without discarding cached events from an offline federated server. */
export function mergeHomeEventSnapshot(
  homeEvents: Event[],
  cachedEvents: Event[],
  cachedCalendars: Calendar[],
): Event[] {
  const remoteCalendarIds = new Set(
    cachedCalendars.flatMap((calendar) =>
      calendar.provider === "musubi" && calendar.serverUrl ? [calendar.id] : [],
    ),
  );
  const preservedRemote = cachedEvents.filter((event) =>
    event.calendars?.some((id) => remoteCalendarIds.has(id)),
  );
  return [
    ...new Map(
      [...preservedRemote, ...homeEvents].map((event) => [event.id, event]),
    ).values(),
  ];
}
