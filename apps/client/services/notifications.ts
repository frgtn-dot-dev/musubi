import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { Event, ReminderRule, RemindersDocument, SILENT_REMINDER_RULE } from "@musubi/types";
import {
  resolveReminderRule,
  resolveReminders,
  type ReminderContext,
  type ResolvedReminder,
} from "@musubi/calendar";
import { eq, inArray } from "drizzle-orm";
import { db } from "./db";
import { notificationsTable } from "@/db/schema";
import { cacheGetReminders, cacheSetReminders } from "./eventsCache";
import { useSettingsStore } from "@/store/useSettingsStore";
import { deviceTimezone } from "@/lib/timezone";

const REMINDER_CHANNEL_ID = "musubi-reminders";

// This device is an EXECUTOR, not the authority. Which events get a reminder is
// a set of rules on the server (global default → per-calendar → per-event), so
// it roams to every device the user signs into. Here we only ask
// `resolveReminders` what should fire, hand that to the OS, and keep a receipt
// so the next reconcile knows what it already scheduled.
//
// Everything the user changes — an event moving, a calendar rule, an SSE from
// another device — ends in the same call: `syncScheduledReminders`.

// How far ahead to hand notifications to the OS. A daily standup needs more
// than the next one scheduled: an app that is not opened for a week would
// otherwise remind once and go quiet.
// ponytail: a flat horizon, not a per-series count. Shorten it if the OS ever
// complains about the number of pending notifications (iOS caps around 64).
const HORIZON_DAYS = 14;

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

async function ensureAndroidReminderChannel() {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync(REMINDER_CHANNEL_ID, {
    name: "Event reminders",
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: "#C8553D",
  });
}

// ── The rules ────────────────────────────────────────────────────────────────

// Last known rules, so a scheduling pass triggered before the network answers
// still resolves against something real rather than silently doing nothing.
let rules: RemindersDocument | null = null;

/** Seed from the local cache. Safe to call repeatedly; the network still wins. */
export async function loadCachedReminderRules() {
  rules ??= await cacheGetReminders();
  return rules;
}

/** The server's answer, from a refresh or an SSE `reminders_updated`. */
export async function storeReminderRules(document: RemindersDocument) {
  rules = document;
  await cacheSetReminders(document).catch(() => undefined);
}

export function reminderRules() {
  return rules;
}

// Writing a rule needs the API, which is a hook. Registering the writer once
// from `useApi` keeps every caller — a modal, a series split, a settings row —
// from having to thread an api object down to it. Same shape as
// `setHomeRequester` in services/federation.ts.
type ReminderWriter = (
  scope: "calendars" | "events",
  id: string,
  rule: ReminderRule | null,
) => Promise<void>;

let writeRemoteRule: ReminderWriter | null = null;

export function setReminderWriter(writer: ReminderWriter) {
  writeRemoteRule = writer;
}

function applyLocally(scope: "calendars" | "events", id: string, rule: ReminderRule | null) {
  if (!rules) return;
  const branch = { ...rules[scope] };
  if (rule) branch[id] = rule;
  else delete branch[id];
  rules = { ...rules, [scope]: branch };
  void cacheSetReminders(rules).catch(() => undefined);
}

/**
 * Set (or clear) my override on one event.
 *
 * The server write happens first: it is the copy that roams, and a local
 * schedule the server never heard about would vanish on the next refresh.
 */
export async function setEventReminderRule(event: Event, rule: ReminderRule | null) {
  if (!writeRemoteRule) throw new Error("Reminder writer is not bound yet.");
  await writeRemoteRule("events", event.id, rule);
  applyLocally("events", event.id, rule);

  await cancelEventNotification(event.id);
  await syncScheduledReminders([event], { onlyEventIDs: [event.id] });
}

/** My rule for a whole calendar. Every event in it may change, so pass them all. */
export async function setCalendarReminderRule(
  calendarID: string,
  rule: ReminderRule | null,
  events: Event[],
) {
  if (!writeRemoteRule) throw new Error("Reminder writer is not bound yet.");
  await writeRemoteRule("calendars", calendarID, rule);
  applyLocally("calendars", calendarID, rule);

  await syncScheduledReminders(events);
}

function context(): ReminderContext | null {
  if (!rules) return null;
  const settings = useSettingsStore.getState();
  return {
    calendarOrder: settings.calendarOrder,
    calendarRules: rules.calendars,
    defaultRule: rules.default,
    eventRules: rules.events,
    timezone: deviceTimezone(),
  };
}

/**
 * The rule that currently applies to an event, inherited or not.
 *
 * The event form uses this to open on what will actually happen rather than on
 * a global default that a calendar rule may have overruled two levels up.
 */
export function effectiveReminderRule(event: Pick<Event, "id" | "calendars">): ReminderRule {
  const ctx = context();
  if (!ctx) return SILENT_REMINDER_RULE;
  return resolveReminderRule(
    { id: event.id, calendars: event.calendars ?? [] },
    ctx,
  );
}

/**
 * What the event would get with no override of its own.
 *
 * The event form compares its result against this: when they agree it clears
 * the override instead of writing one, so the event keeps following its
 * calendar and a later change to that calendar still reaches it.
 */
export function inheritedReminderRule(
  event: Pick<Event, "id" | "calendars">,
): ReminderRule {
  const ctx = context();
  if (!ctx) return SILENT_REMINDER_RULE;
  return resolveReminderRule(
    { id: event.id, calendars: event.calendars ?? [] },
    { ...ctx, eventRules: {} },
  );
}

// ── The OS ───────────────────────────────────────────────────────────────────

async function schedule(reminder: ResolvedReminder): Promise<string> {
  await ensureAndroidReminderChannel();
  return Notifications.scheduleNotificationAsync({
    content: {
      title: reminder.title,
      body: reminder.occurrenceStart.toLocaleString(undefined, {
        dateStyle: "medium",
        ...(reminder.isAllDay ? {} : { timeStyle: "short" }),
      }),
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: reminder.dueAt,
      ...(Platform.OS === "android" ? { channelId: REMINDER_CHANNEL_ID } : {}),
    },
  });
}

async function cancel(identifier: string) {
  await Notifications.cancelScheduledNotificationAsync(identifier).catch(() => undefined);
}

/**
 * Make the OS agree with the rules, for the events this device knows about.
 *
 * A diff rather than a wipe-and-reschedule: cancelling everything on every sync
 * would drop and re-add hundreds of pending notifications several times a
 * minute, and on iOS that is a good way to hit the pending-notification cap
 * mid-rebuild and lose one.
 */
export async function syncScheduledReminders(
  events: Event[],
  options?: {
    /**
     * Limit the pass to these events. Without it, every receipt this device
     * holds is compared against `events` — so a single changed event must not
     * be passed on its own, or every other reminder reads as gone.
     */
    onlyEventIDs?: string[];
  },
) {
  const ctx = context() ?? ((await loadCachedReminderRules()) ? context() : null);
  if (!ctx) return;

  const scope = options?.onlyEventIDs ? new Set(options.onlyEventIDs) : null;

  const now = new Date();
  const wanted = resolveReminders({
    context: ctx,
    events: events.map((event) => ({
      calendars: event.calendars ?? [],
      end: new Date(event.end),
      id: event.id,
      isAllDay: event.isAllDay,
      isCanceled: event.isCanceled,
      recurrence: event.recurrence,
      start: new Date(event.start),
      title: event.title,
    })),
    from: now,
    to: new Date(now.getTime() + HORIZON_DAYS * 24 * 3600 * 1000),
  });

  const allRows = await db.select().from(notificationsTable);
  const rows = scope ? allRows.filter((row) => scope.has(row.eventID)) : allRows;
  const scheduled = new Map(rows.map((row) => [row.occurrenceID, row]));
  const wantedByID = new Map(wanted.map((reminder) => [reminder.occurrenceID, reminder]));

  // Gone, or moved: an event that shifted by an hour keeps its occurrence id
  // only if its start did not change, so a moved event lands here.
  const stale = rows.filter((row) => {
    const match = wantedByID.get(row.occurrenceID);
    return !match || match.dueAt.toISOString() !== row.triggerDate;
  });
  for (const row of stale) await cancel(row.identifier);
  if (stale.length) {
    await db
      .delete(notificationsTable)
      .where(inArray(notificationsTable.id, stale.map((row) => row.id)));
  }

  const staleIDs = new Set(stale.map((row) => row.occurrenceID));
  for (const reminder of wanted) {
    const existing = scheduled.get(reminder.occurrenceID);
    if (existing && !staleIDs.has(reminder.occurrenceID)) continue;

    const identifier = await schedule(reminder);
    try {
      await db.insert(notificationsTable).values({
        eventID: reminder.eventID,
        identifier,
        occurrenceID: reminder.occurrenceID,
        triggerDate: reminder.dueAt.toISOString(),
      });
    } catch {
      // Never leave a notification the OS will fire and no row can cancel.
      await cancel(identifier);
    }
  }

  // Only a full pass can tell an orphan from an event it was simply not asked
  // about.
  if (!scope) await forgetUntrackedNotifications();
}

/**
 * Cancel anything pending that no row accounts for.
 *
 * The upgrade from per-event reminders dropped the old receipts table, and a
 * crash between `scheduleNotificationAsync` and its insert leaves the same
 * orphan: a notification that will fire and that nothing can ever cancel.
 */
async function forgetUntrackedNotifications() {
  const [pending, rows] = await Promise.all([
    Notifications.getAllScheduledNotificationsAsync().catch(() => []),
    db.select({ identifier: notificationsTable.identifier }).from(notificationsTable),
  ]);

  const known = new Set(rows.map((row) => row.identifier));
  for (const notification of pending) {
    if (!known.has(notification.identifier)) await cancel(notification.identifier);
  }
}

/** One event's reminders, dropped now rather than at the next reconcile. */
export async function cancelEventNotification(eventID: string) {
  const rows = await db
    .select()
    .from(notificationsTable)
    .where(eq(notificationsTable.eventID, eventID));
  for (const row of rows) await cancel(row.identifier);
  await db.delete(notificationsTable).where(eq(notificationsTable.eventID, eventID));
}

/** Sign-out / account deletion: the next account must not inherit reminders. */
export async function clearAllEventNotifications() {
  await Notifications.cancelAllScheduledNotificationsAsync().catch(() => undefined);
  await db.delete(notificationsTable);
  rules = null;
}

/** Ask only when the user is actively enabling/saving their first reminder. */
export async function requestEventNotificationPermission() {
  await ensureAndroidReminderChannel();

  const existing = await Notifications.getPermissionsAsync();
  if (existing.status === "granted") return true;
  if (!existing.canAskAgain) return false;

  const requested = await Notifications.requestPermissionsAsync();
  // Denied is a valid choice — future saves return false without reopening the
  // system prompt. The event itself is still saved normally.
  return requested.status === "granted";
}
