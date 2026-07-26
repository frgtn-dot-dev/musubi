export type EventRangeInput = {
  calendarIds: readonly string[];
  end: Date;
  filterFingerprint: string;
  serverOrigin: string;
  start: Date;
  userId: string;
};

function sorted(values: readonly string[]) {
  return [...values].sort();
}

export const queryKeys = {
  session: (serverOrigin: string) => ["session", serverOrigin] as const,

  settings: (serverOrigin: string, userId: string) =>
    ["settings", serverOrigin, userId] as const,

  calendars: (serverOrigin: string, userId: string) =>
    ["calendars", serverOrigin, userId] as const,

  pages: (serverOrigin: string, userId: string) =>
    ["pages", serverOrigin, userId] as const,

  attendees: (
    serverOrigin: string,
    userId: string,
    eventId: string,
  ) => ["attendees", serverOrigin, userId, eventId] as const,

  eventRange: (input: EventRangeInput) =>
    [
      "events",
      input.serverOrigin,
      input.userId,
      sorted(input.calendarIds),
      input.start.toISOString(),
      input.end.toISOString(),
      input.filterFingerprint,
    ] as const,
};

export function getServerOrigin() {
  return typeof window === "undefined" ? "same-origin" : window.location.origin;
}
