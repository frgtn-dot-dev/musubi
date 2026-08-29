import { resolveReminders, type ReminderEvent } from "@musubi/calendar";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getEvents,
  getReminders,
  getServerCapabilities,
  getSettings,
  getSettingsDocument,
  patchSettings,
  putReminderRule,
} from "~/api/resources";
import { getServerOrigin, queryKeys } from "~/api/query-keys";
import {
  notifyReminder,
  requestReminderPermission,
  scheduleReminders,
} from "./reminder-scheduler";
import type { ReminderControl } from "./reminder-control";
import {
  currentSubscription,
  pushSupported,
  reregisterPush,
  subscribeToPush,
  unsubscribeFromPush,
} from "~/push/subscribe";

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

  // Whether the server can push at all, and whether this browser is on its
  // list. Both cheap; both decide whether the tab schedules for itself.
  const capabilities = useQuery({
    enabled,
    queryFn: ({ signal }) => getServerCapabilities(signal),
    queryKey: ["server-capabilities", origin],
    staleTime: 5 * 60_000,
  });
  const pushPublicKey = capabilities.data?.pushPublicKey ?? null;

  const [pushing, setPushing] = useState(false);
  useEffect(() => {
    let live = true;
    void currentSubscription().then((subscription) => {
      if (!live) return;
      setPushing(Boolean(subscription));
      // Say it again on every load. The server drops a subscription silently
      // when a push 410s, and this browser would go on believing it is being
      // pushed to — so it would not schedule for itself either. One idempotent
      // write puts the row back rather than waiting for someone to notice.
      if (subscription) void reregisterPush(subscription);
    });
    return () => {
      live = false;
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

  // When the server is pushing to this browser, the tab must NOT also schedule:
  // the two would race to announce the same occurrence and, being raised from
  // different places, may not coalesce on their tag. The server wins because it
  // works whether the tab is open or not.
  useEffect(() => {
    if (pushing) return;
    return scheduleReminders(due, notifyReminder);
  }, [due, pushing]);

  const queryClient = useQueryClient();
  const calendarOrder = settings.data?.calendarOrder ?? NO_ORDER;

  // Turning this on is the moment to ask for permission — not at launch, and
  // not the first time a reminder happens to come due.
  const setPush = useCallback(
    async (wanted: boolean) => {
      if (!wanted) {
        await unsubscribeFromPush();
        setPushing(false);
        return false;
      }
      if (!pushPublicKey || !(await requestReminderPermission())) return false;

      const subscribed = await subscribeToPush(pushPublicKey);
      setPushing(subscribed);
      // Now the server has to place "the evening before at 18:00" on this
      // person's clock, and it cannot ask the browser at dispatch time. Written
      // here rather than on page load: this is a deliberate act by the user, so
      // an extra request and a settings revision are earned.
      if (subscribed) void reportTimezone();
      return subscribed;
    },
    // `setPushing` is stable, but the compiler checks what the body reads
    // rather than what is stable, and a skipped optimization is a lint error.
    [pushPublicKey, setPushing],
  );

  // Travelling changes the answer. Only for browsers that already opted into
  // push, and once per mount — a signed-out or tab-only user writes nothing.
  const reported = useRef(false);
  const storedTimezone = settings.data?.timezone;
  useEffect(() => {
    if (!pushing || reported.current || !storedTimezone) return;
    if (storedTimezone === browserTimezone()) return;
    reported.current = true;
    void reportTimezone().then(() =>
      queryClient.invalidateQueries({
        queryKey: queryKeys.settings(origin, userId),
      }),
    );
  }, [origin, pushing, queryClient, storedTimezone, userId]);

  const push = useMemo(
    () => ({
      // Absent key means the server has no VAPID keys, so there is nothing to
      // offer and the toggle should not appear at all.
      available: Boolean(pushPublicKey) && pushSupported(),
      enabled: pushing,
      set: setPush,
    }),
    [pushPublicKey, pushing, setPush],
  );

  return useMemo(
    (): ReminderControl | undefined =>
      reminders.data
        ? {
            calendarOrder,
            document: reminders.data,
            push,
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
    [calendarOrder, origin, push, queryClient, reminders.data, userId],
  );
}

/**
 * Store this browser's zone against the account.
 *
 * Reads the document first because the patch is compare-and-swap and the
 * workspace only caches the plain settings, which carry no revision. Failures
 * are swallowed: a conflict or an offline tab means the zone stays as it was,
 * which is stale rather than wrong, and the next subscribe tries again.
 */
async function reportTimezone() {
  try {
    const document = await getSettingsDocument();
    await patchSettings({
      baseRevision: document.revision,
      patch: { timezone: browserTimezone() },
    });
  } catch {
    // Nothing the user needs to see.
  }
}

export function browserTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}
