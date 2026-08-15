import { resolveReminders, type ReminderEvent } from "@musubi/calendar";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import {
  getEvents,
  getReminders,
  getSettings,
  getSettingsDocument,
  patchSettings,
  putReminderRule,
} from "~/api/resources";
import { getServerOrigin, queryKeys } from "~/api/query-keys";
import { notifyReminder, scheduleReminders } from "./reminder-scheduler";
import type { ReminderControl } from "./reminder-control";

// How far ahead to resolve. Long enough that a tab left open over a weekend
// still rings on Monday, short enough that the event query stays small.
const HORIZON_DAYS = 14;

// A stable empty array: `?? []` inline would be a new value every render and
// every memo below it would rebuild for nothing.
const NO_ORDER: readonly string[] = [];

/**
 * Ring for events while this tab is open.
 *
 * Deliberately its own event query rather than the workspace's: what the user
 * is LOOKING at and what is about to happen are different questions, and
 * paging back to March must not silence today's reminders.
 */
export function useReminders(userId: string) {
  const enabled = typeof window !== "undefined" && userId !== "anonymous";
  const origin = getServerOrigin();

  const reminders = useQuery({
    enabled,
    queryFn: ({ signal }) => getReminders(signal),
    queryKey: queryKeys.reminders(origin, userId),
  });

  const settings = useQuery({
    enabled,
    queryFn: ({ signal }) => getSettings(signal),
    queryKey: queryKeys.settings(origin, userId),
  });

  // Refetched on the same cadence as everything else through the SSE
  // invalidations; the range itself only needs to be recomputed when the
  // horizon moves, which a day boundary does.
  const range = useMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return {
      end: new Date(start.getTime() + HORIZON_DAYS * 24 * 3_600_000),
      start,
    };
  }, []);

  const events = useQuery({
    enabled,
    queryFn: ({ signal }) => getEvents(range, signal),
    queryKey: queryKeys.eventRange({
      calendarIds: ["@all"],
      end: range.end,
      filterFingerprint: "reminders",
      serverOrigin: origin,
      start: range.start,
      userId,
    }),
  });

  const due = useMemo(() => {
    if (!reminders.data || !events.data) return [];

    const now = new Date();
    return resolveReminders({
      context: {
        calendarOrder: settings.data?.calendarOrder ?? [],
        calendarRules: reminders.data.calendars,
        defaultRule: reminders.data.default,
        eventRules: reminders.data.events,
        timezone: settings.data?.timezone ?? browserTimezone(),
      },
      events: events.data.events.map(
        (event): ReminderEvent => ({
          calendars: event.calendars ?? [],
          end: new Date(event.end),
          id: event.id,
          isAllDay: event.isAllDay,
          isCanceled: event.isCanceled,
          recurrence: event.recurrence,
          start: new Date(event.start),
          title: event.title,
        }),
      ),
      from: now,
      to: new Date(now.getTime() + HORIZON_DAYS * 24 * 3_600_000),
    });
  }, [events.data, reminders.data, settings.data]);

  useEffect(() => scheduleReminders(due, notifyReminder), [due]);

  const queryClient = useQueryClient();
  const calendarOrder = settings.data?.calendarOrder ?? NO_ORDER;

  // Tell the server where this browser is. All-day reminders are a wall-clock
  // time, so a user who only ever signs in on the web would otherwise have
  // "the evening before at 18:00" mean 18:00 UTC.
  const storedTimezone = settings.data?.timezone;
  useEffect(() => {
    if (!enabled || !settings.data) return;
    const here = browserTimezone();
    if (storedTimezone === here) return;

    // The workspace caches the plain settings, which carry no revision; the
    // document does, and this runs about once per browser.
    void getSettingsDocument()
      .then((document) =>
        patchSettings({
          baseRevision: document.revision,
          patch: { timezone: here },
        }),
      )
      .then(() =>
        queryClient.invalidateQueries({
          queryKey: queryKeys.settings(origin, userId),
        }),
      )
      // A conflict or an offline tab is not worth surfacing: the next load
      // tries again, and the stored zone is only ever stale, never wrong.
      .catch(() => undefined);
  }, [enabled, origin, queryClient, settings.data, storedTimezone, userId]);

  return useMemo(
    (): ReminderControl | undefined =>
      reminders.data
        ? {
            calendarOrder,
            document: reminders.data,
            onCalendarChange: async (calendarId, rule) => {
              await putReminderRule("calendars", calendarId, rule);
              await queryClient.invalidateQueries({
                queryKey: queryKeys.reminders(origin, userId),
              });
            },
            onChange: async (eventId, rule) => {
              await putReminderRule("events", eventId, rule);
              // The server broadcasts `reminders_updated` to this user's other
              // devices, but not back down the socket that caused it.
              await queryClient.invalidateQueries({
                queryKey: queryKeys.reminders(origin, userId),
              });
            },
          }
        : undefined,
    [calendarOrder, origin, queryClient, reminders.data, userId],
  );
}

export function browserTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}
