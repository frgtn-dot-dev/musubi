import { logger } from "@musubi/config";
import {
  canSendEmail,
  getEventChangesHtml,
  sendEmail,
  type EventChange,
} from "@musubi/emails";
import {
  DEFAULT_NOTIFICATION_EMAILS,
  type NotificationEmails,
} from "@musubi/types";
import {
  deletePendingNotifications,
  getDuePendingNotifications,
} from "@musubi/db";
import type { EventChangePayload } from "./event_notifications";

/**
 * Send the emails that were waiting for their moment.
 *
 * Everything here happened because a PERSON did something — moved an event,
 * decided a poll. That is why it is batched and why it is opt-out, and why it
 * is a separate pass from the reminder dispatcher: reminders need push keys,
 * these need a mail server, and an install can have either, both or neither.
 */

export const EVENT_CHANGED = "event_changed";

/**
 * How long a change waits before it is told.
 *
 * Long enough that rearranging an afternoon is one email rather than eight,
 * short enough that "the meeting moved to now" still arrives while it is
 * useful. Set from the first change of a run, never extended.
 */
export const BATCH_DELAY_MS = 3 * 60_000;

export function batchDueAt(now = new Date()) {
  return new Date(now.getTime() + BATCH_DELAY_MS);
}

/**
 * When to stop trying.
 *
 * A row is only deleted after its email is accepted, so an address that always
 * fails would otherwise be retried every minute until the end of time. A day
 * late is stale news regardless — nobody needs to hear on Tuesday that
 * Monday's meeting moved.
 */
export const GIVE_UP_AFTER_MS = 24 * 3_600_000;

type DueRow = Awaited<ReturnType<typeof getDuePendingNotifications>>[number];

/**
 * An instant, as a sentence, on the reader's clock.
 *
 * The queue stores ISO because the sentence depends on who is reading. An
 * all-day event is a timezone-invariant date pinned to UTC midnight, so it is
 * rendered there — putting Christmas in somebody's local zone moves it.
 */
function when(iso: string, isAllDay: boolean, timezone: string) {
  const options: Intl.DateTimeFormatOptions = {
    dateStyle: "full",
    timeZone: isAllDay ? "UTC" : timezone,
    ...(isAllDay ? {} : { timeStyle: "short" as const }),
  };
  try {
    return new Intl.DateTimeFormat("en-GB", options).format(new Date(iso));
  } catch {
    return new Intl.DateTimeFormat("en-GB", { ...options, timeZone: "UTC" }).format(
      new Date(iso),
    );
  }
}

/** Queue row → the strings the template prints, on this reader's clock. */
export function toEventChange(
  payload: EventChangePayload,
  timezone: string,
): EventChange {
  return {
    kind: payload.kind,
    title: payload.title,
    when: payload.kind === "moved" ? when(payload.start, payload.isAllDay, timezone) : undefined,
    wasWhen: payload.wasStart
      ? when(payload.wasStart, payload.isAllDay, timezone)
      : payload.kind === "cancelled"
        ? when(payload.start, payload.isAllDay, timezone)
        : undefined,
  };
}

/** Does this person want this kind of mail? Missing settings means the defaults. */
export function wants(
  preferences: NotificationEmails | null,
  kind: string,
): boolean {
  const settings = preferences ?? DEFAULT_NOTIFICATION_EMAILS;
  if (kind === EVENT_CHANGED) return settings.eventChanged;
  // An unknown kind is a newer server's row, or a bug. Sending is the failure
  // that annoys somebody; not sending is the one nobody notices, so stay quiet.
  return false;
}

/**
 * Group by person, because the whole point is one email each.
 *
 * Rows the reader does not want are still returned — they have to be deleted
 * either way, or they sit in the table being re-read on every pass forever.
 */
export function planDeliveries(rows: DueRow[]) {
  const byUser = new Map<
    string,
    { changes: EventChange[]; email: string; ids: string[]; name: string }
  >();
  const discard: string[] = [];

  for (const row of rows) {
    if (!wants(row.notificationEmails, row.kind)) {
      discard.push(row.id);
      continue;
    }

    const existing = byUser.get(row.userID) ?? {
      changes: [],
      email: row.email,
      ids: [],
      name: row.name,
    };
    existing.ids.push(row.id);
    existing.changes.push(
      toEventChange(row.payload as EventChangePayload, row.timezone ?? "UTC"),
    );
    byUser.set(row.userID, existing);
  }

  return { discard, deliveries: [...byUser.values()] };
}

export async function drainPendingNotifications(now = new Date()) {
  if (!canSendEmail()) return { sent: 0 };

  const all = await getDuePendingNotifications(now);
  if (all.length === 0) return { sent: 0 };

  const stale = all.filter(
    (row) => now.getTime() - row.dueAt.getTime() > GIVE_UP_AFTER_MS,
  );
  if (stale.length > 0) {
    logger.warn("notifications.abandoned", { count: stale.length });
    await deletePendingNotifications(stale.map((row) => row.id));
  }

  const staleIDs = new Set(stale.map((row) => row.id));
  const rows = all.filter((row) => !staleIDs.has(row.id));

  const { discard, deliveries } = planDeliveries(rows);
  // Unwanted rows go first and unconditionally: a preference that only takes
  // effect when the send succeeds is not a preference.
  await deletePendingNotifications(discard);

  let sent = 0;
  for (const delivery of deliveries) {
    try {
      await sendEmail(
        delivery.email,
        delivery.changes.length === 1
          ? delivery.changes[0]!.kind === "cancelled"
            ? "An event was cancelled"
            : "An event moved"
          : `${delivery.changes.length} events changed`,
        getEventChangesHtml(delivery.name, delivery.changes),
      );
      // Only on success: a row deleted before a failed send is a change nobody
      // is ever told about.
      await deletePendingNotifications(delivery.ids);
      sent += 1;
    } catch (error) {
      logger.error("notifications.email_failed", {
        error,
        events: delivery.changes.length,
      });
    }
  }

  return { sent };
}
