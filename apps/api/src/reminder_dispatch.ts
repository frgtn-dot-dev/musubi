import { resolveReminders, type ReminderEvent } from "@musubi/calendar";
import { config, logger } from "@musubi/config";
import {
  deletePushSubscriptionsByEndpoint,
  getDeclinedEventIDs,
  getDispatchCursor,
  getPushSubscriptionsByUser,
  getRemindersDocument,
  getUserSettings,
  getUsersEvents,
  markPushSubscriptionsSeen,
  setDispatchCursor,
} from "@musubi/db";
import webpush from "web-push";
import { recordReminderPush } from "./metrics";

/**
 * Send event reminders to browsers that are not open.
 *
 * The clients already ring for themselves while they are running; this exists
 * for the case they cannot cover — a closed laptop at 8:50 for a nine o'clock
 * meeting. It resolves with the SAME `resolveReminders` the phone and the web
 * use, so a declined birthday is silent in all three places for one reason
 * rather than three.
 */

export const CURSOR_NAME = "reminders";

/**
 * How late a reminder may be and still be worth sending.
 *
 * After an outage the window since the cursor could be hours wide. Firing all
 * of it would announce a stack of meetings that have already happened, which is
 * worse than silence — the point of a reminder is the time before the thing.
 */
export const MAX_CATCHUP_MS = 15 * 60_000;

/**
 * The slice of time to dispatch, given where we left off.
 *
 * Exported for its own sake: this is the part with the edge cases, and it is
 * the part that decides whether a restart double-sends, skips, or floods.
 */
export function dispatchWindow(
  cursor: Date | null,
  now: Date,
  maxCatchupMs = MAX_CATCHUP_MS,
) {
  const earliest = new Date(now.getTime() - maxCatchupMs);
  // No cursor is a first run (or a wiped table). Starting from the beginning of
  // time would send every reminder anybody ever had, so a first run only looks
  // as far back as it would after a short outage.
  if (!cursor) return { from: earliest, to: now, skipped: false };

  // A cursor in the future is a clock that went backwards. Trusting it would
  // silence reminders until real time caught up.
  if (cursor > now) return { from: earliest, to: now, skipped: false };

  return {
    from: cursor < earliest ? earliest : cursor,
    to: now,
    skipped: cursor < earliest,
  };
}

/** The one line under the title: when the thing actually is, where they are. */
function formatWhen(start: Date, isAllDay: boolean, timezone: string) {
  const options: Intl.DateTimeFormatOptions = {
    dateStyle: "medium",
    // An all-day event is a timezone-invariant DATE pinned to UTC midnight;
    // rendering it in the reader's zone would move Christmas.
    timeZone: isAllDay ? "UTC" : timezone,
    ...(isAllDay ? {} : { timeStyle: "short" as const }),
  };
  try {
    return new Intl.DateTimeFormat("en-GB", options).format(start);
  } catch {
    // A zone Intl does not know: wrong by hours beats a thrown dispatcher.
    return new Intl.DateTimeFormat("en-GB", { ...options, timeZone: "UTC" }).format(start);
  }
}

/** The events one person can see in a window, in the shape the resolver wants. */
async function reminderEventsFor(userID: string, from: Date, to: Date) {
  const rows = await getUsersEvents(userID, { end: to, start: from });
  const byID = new Map<string, ReminderEvent>();

  for (const { calendarID, event } of rows) {
    if (event.deletedAt) continue;
    const existing = byID.get(event.id);
    if (existing) {
      existing.calendars.push(calendarID);
      continue;
    }
    byID.set(event.id, {
      calendars: [calendarID],
      end: event.end,
      id: event.id,
      isAllDay: event.isAllDay,
      isCanceled: event.isCanceled,
      recurrence: event.recurrence,
      start: event.start,
      title: event.title,
    });
  }

  return [...byID.values()];
}

export function pushEnabled() {
  return Boolean(config.push.vapidPublicKey && config.push.vapidPrivateKey);
}

let vapidReady = false;

function ensureVapid() {
  if (vapidReady) return;
  webpush.setVapidDetails(
    config.push.vapidSubject,
    config.push.vapidPublicKey,
    config.push.vapidPrivateKey,
  );
  vapidReady = true;
}

/**
 * One pass: work out the window, then push whatever falls inside it.
 *
 * The cursor advances only after the sends, so a crash mid-pass repeats a
 * window rather than losing it. Push is at-least-once by nature — the payload
 * carries the occurrence id as a notification tag, so a repeat replaces the
 * banner instead of stacking a second one.
 */
export async function dispatchDueReminders(now = new Date()) {
  if (!pushEnabled()) return { sent: 0, users: 0 };
  ensureVapid();

  const cursor = await getDispatchCursor(CURSOR_NAME);
  const window = dispatchWindow(cursor, now);
  if (window.skipped) {
    logger.warn("reminders.dispatch.window_clamped", {
      cursor: cursor?.toISOString(),
      from: window.from.toISOString(),
    });
  }

  const subscriptions = await getPushSubscriptionsByUser();
  let sent = 0;
  const gone: string[] = [];
  const delivered: string[] = [];

  for (const [userID, endpoints] of subscriptions) {
    let due;
    let timezone = "UTC";
    try {
      const [document, settings, declined, events] = await Promise.all([
        getRemindersDocument(userID),
        getUserSettings(userID),
        getDeclinedEventIDs(userID),
        // The resolver expands occurrences itself and needs room for a rule
        // that fires days ahead, so it is handed a window that starts here and
        // reaches past `to`; it does the narrowing.
        reminderEventsFor(
          userID,
          window.from,
          new Date(window.to.getTime() + 31 * 24 * 3_600_000),
        ),
      ]);

      timezone = settings.timezone;
      due = resolveReminders({
        context: {
          attendance: Object.fromEntries(
            declined.map((id) => [id, "declined" as const]),
          ),
          calendarOrder: settings.calendarOrder,
          calendarRules: document.calendars,
          defaultRule: document.default,
          eventRules: document.events,
          timezone: settings.timezone,
        },
        events,
        from: window.from,
        to: window.to,
      });
    } catch (error) {
      // One user's bad data must not stop everybody else's reminders.
      logger.error("reminders.dispatch.user_failed", { error, userID });
      continue;
    }

    for (const reminder of due) {
      const payload = JSON.stringify({
        // Written on the server, so the reader's zone has to be applied here —
        // the browser only renders what arrives. An all-day event has no time
        // worth showing; a timed one is useless without it.
        body: formatWhen(reminder.occurrenceStart, reminder.isAllDay, timezone),
        eventID: reminder.eventID,
        tag: reminder.occurrenceID,
        title: reminder.title,
      });

      for (const subscription of endpoints) {
        try {
          await webpush.sendNotification(
            {
              endpoint: subscription.endpoint,
              keys: { auth: subscription.auth, p256dh: subscription.p256dh },
            },
            payload,
          );
          sent += 1;
          delivered.push(subscription.endpoint);
        } catch (error) {
          const status = (error as { statusCode?: number }).statusCode;
          // 404/410 is the push service saying this endpoint is finished —
          // permission revoked, storage cleared, browser reinstalled. Keeping
          // it would mean retrying a dead address on every tick forever.
          if (status === 404 || status === 410) {
            gone.push(subscription.endpoint);
            recordReminderPush("gone");
          } else {
            recordReminderPush("failed");
            logger.warn("reminders.push.failed", { error, status, userID });
          }
        }
      }
    }
  }

  recordReminderPush("sent", sent);
  await deletePushSubscriptionsByEndpoint([...new Set(gone)]);
  await markPushSubscriptionsSeen([...new Set(delivered)]);
  await setDispatchCursor(CURSOR_NAME, window.to);

  return { sent, users: subscriptions.size };
}
