import type { Calendar, Event } from "@musubi/types";

// Which server a calendar lives on. Writes must land on the server that owns the
// calendar, so every mutation resolves its target here first. A calendar that
// isn't in the map is native to the home server (no connection id).
//
// Pure on purpose: the routing rules are the part worth testing, not the fetch.

export type ConnectionMap = Map<string, string>;

/**
 * Routing straight off a calendar row. Federated calendars are tagged with
 * `provider: "musubi"` and carry their connection id in `accountId`, so any
 * component holding the calendar can route without a lookup table.
 */
export function connectionOfCalendar(
  calendar: Calendar | undefined | null,
): string | undefined {
  return calendar?.provider === "musubi"
    ? (calendar.accountId ?? undefined)
    : undefined;
}

/**
 * Safe to call with any calendar list, federated or mixed: provider mirrors
 * (Google/Outlook/CalDAV) also carry an `accountId`, so membership is decided by
 * the `musubi` provider tag rather than by that field being present.
 */
export function federatedConnectionMap(calendars: Calendar[]): ConnectionMap {
  const map: ConnectionMap = new Map();
  for (const calendar of calendars) {
    const connectionId = connectionOfCalendar(calendar);
    if (connectionId) map.set(calendar.id, connectionId);
  }
  return map;
}

/** The calendar an event is owned by — its home, falling back to the first link. */
export function eventHomeCalendarId(event: Event): string | undefined {
  return event.originCalendarID ?? event.calendars[0];
}

export function connectionForCalendar(
  map: ConnectionMap,
  calendarId: string | undefined | null,
): string | undefined {
  return calendarId ? map.get(calendarId) : undefined;
}

export function connectionForEvent(
  map: ConnectionMap,
  event: Event,
): string | undefined {
  return connectionForCalendar(map, eventHomeCalendarId(event));
}

/**
 * True when the given calendars don't all live on the same server. One event
 * cannot span servers: each origin only knows its own calendars, so the write
 * would silently drop the other side's links.
 */
export function spansMultipleServers(
  map: ConnectionMap,
  calendarIds: string[],
): boolean {
  const servers = new Set(
    calendarIds.map((calendarId) => map.get(calendarId) ?? "home"),
  );
  return servers.size > 1;
}
