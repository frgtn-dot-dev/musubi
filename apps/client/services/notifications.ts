import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import {
  DEFAULT_REMINDER_RULE,
  Event,
  ReminderRule,
  RemindersDocument,
  SILENT_REMINDER_RULE,
} from "@musubi/types";
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

/**
 * One channel per kind of reminder, because they are not equally urgent.
 *
 * "Porada za 10 minut" should interrupt; "zítra večer jsou narozeniny" should
 * not have to. On Android the channel is where that lives — importance, sound
 * and vibration all belong to the user once it exists, and a single channel
 * means one answer for both. Splitting them is the difference between someone
 * silencing all-day reminders and someone silencing Musubi.
 *
 * A channel is created the first time its kind is actually scheduled. Declaring
 * all of them up front would put rows in system settings for notifications this
 * app has never sent, which is how a settings screen stops being trustworthy.
 */
const REMINDER_CHANNELS = {
  allDay: {
    id: "musubi-reminders-allday",
    // DEFAULT, not MAX: an all-day reminder is a heads-up, not an interruption.
    // Somebody who wants it louder can say so, and now has somewhere to.
    importance: () => Notifications.AndroidImportance.DEFAULT,
    name: "All-day reminders",
    vibrationPattern: [0, 200],
  },
  timed: {
    id: "musubi-reminders-timed",
    importance: () => Notifications.AndroidImportance.MAX,
    name: "Event reminders",
    vibrationPattern: [0, 250, 250, 250],
  },
} as const;

/**
 * The single channel everything used to go through.
 *
 * Deleted rather than reused: an existing channel's importance belongs to the
 * user, so the OS ignores any change to it. Leaving it would strand whatever
 * they had set on a channel nothing sends to any more.
 */
const RETIRED_CHANNEL_ID = "musubi-reminders";

/** Ties a scheduled reminder to the buttons below. */
export const REMINDER_CATEGORY_ID = "musubi-reminder";
export const ACTION_DECLINE = "decline";
export const ACTION_OPEN = "open";

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

/**
 * The buttons on a reminder.
 *
 * Registered once per launch rather than per notification: the category is a
 * property of the OS, and a scheduled reminder only carries its id. A reminder
 * scheduled before this ran still fires — it just shows without buttons, which
 * is why this is done at startup and not lazily.
 *
 * Declining from here is the same write the app makes, so the organizer sees it
 * immediately and — by the rules in @musubi/calendar — the event stops
 * reminding on every device.
 */
export async function registerReminderActions() {
  await Notifications.setNotificationCategoryAsync(REMINDER_CATEGORY_ID, [
    {
      buttonTitle: "Can't make it",
      identifier: ACTION_DECLINE,
      options: { opensAppToForeground: false },
    },
    {
      buttonTitle: "Show in calendar",
      identifier: ACTION_OPEN,
      options: { opensAppToForeground: true },
    },
  ]);
}

// Channels are cheap to re-declare but not free, and `schedule` runs per
// occurrence. Remembering which ones this launch has already set up keeps a
// fifty-reminder reconcile from making fifty round trips to the OS.
const readyChannels = new Set<string>();
let retiredOldChannel = false;

async function ensureReminderChannel(kind: keyof typeof REMINDER_CHANNELS) {
  if (Platform.OS !== "android") return undefined;

  const channel = REMINDER_CHANNELS[kind];
  if (readyChannels.has(channel.id)) return channel.id;

  await Notifications.setNotificationChannelAsync(channel.id, {
    importance: channel.importance(),
    lightColor: "#C8553D",
    name: channel.name,
    vibrationPattern: [...channel.vibrationPattern],
  });
  readyChannels.add(channel.id);

  // Once per launch, not once per channel. Best-effort: the old channel does
  // not exist on a fresh install, and failing to remove it is not worth
  // interrupting a reminder over.
  if (!retiredOldChannel) {
    retiredOldChannel = true;
    await Notifications.deleteNotificationChannelAsync(
      RETIRED_CHANNEL_ID,
    ).catch(() => undefined);
  }

  return channel.id;
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

/**
 * Stand-in rules for a server that has none.
 *
 * An install older than the reminder rules answers 404, and without this the
 * app would resolve against nothing and schedule nothing — silently turning off
 * a feature that worked before the phone was updated. Self-hosted servers move
 * on their admin's schedule, so that gap is a normal state, not a broken one.
 *
 * `notificationsOnByDefault` is the one thing such a server does say about
 * reminders, and it is the same mapping the server-side migration uses, so the
 * phone behaves the way it will once the server catches up.
 *
 * Never cached: it is a substitute for an answer, and a cached substitute would
 * outlive the upgrade that makes it wrong. A real document, including one read
 * from the cache, always wins.
 */
export async function adoptLegacyReminderRules(notificationsOnByDefault: boolean) {
  if (await loadCachedReminderRules()) return false;

  rules = {
    calendars: {},
    default: notificationsOnByDefault
      ? DEFAULT_REMINDER_RULE
      : SILENT_REMINDER_RULE,
    events: {},
  };
  return true;
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
  const channelId = await ensureReminderChannel(
    reminder.isAllDay ? "allDay" : "timed",
  );
  await registerReminderActions();
  return Notifications.scheduleNotificationAsync({
    content: {
      title: reminder.title,
      body: reminder.occurrenceStart.toLocaleString(undefined, {
        dateStyle: "medium",
        ...(reminder.isAllDay ? {} : { timeStyle: "short" }),
      }),
      categoryIdentifier: REMINDER_CATEGORY_ID,
      // What the buttons act on. Without it a tap has nothing to open and
      // "Can't make it" has nothing to decline.
      data: {
        eventID: reminder.eventID,
        occurrenceStart: reminder.occurrenceStart.toISOString(),
      },
      // A meeting starting is the case Apple added this level for: it goes
      // through Focus. Reminders only — spend it anywhere else and the level
      // stops meaning anything.
      interruptionLevel: "timeSensitive",
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: reminder.dueAt,
      ...(channelId ? { channelId } : {}),
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
  // Timed only. Asking here creates the channel, and creating the all-day one
  // before anything all-day exists is exactly the empty row this split avoids.
  await ensureReminderChannel("timed");

  const existing = await Notifications.getPermissionsAsync();
  if (existing.status === "granted") return true;
  if (!existing.canAskAgain) return false;

  const requested = await Notifications.requestPermissionsAsync();
  // Denied is a valid choice — future saves return false without reopening the
  // system prompt. The event itself is still saved normally.
  return requested.status === "granted";
}
