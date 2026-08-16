import dayjs from "dayjs";
import timezonePlugin from "dayjs/plugin/timezone";
import utc from "dayjs/plugin/utc";
import type { ReminderRule } from "@musubi/types";
import { expandRecurringEvents } from "./recurrence";

dayjs.extend(utc);
dayjs.extend(timezonePlugin);

/**
 * Which occurrences should ping this person, and when.
 *
 * One resolver, several callers: the mobile app schedules the result with
 * `expo-notifications`, the web app with `setTimeout`, and a future server
 * dispatcher will walk the same list to send push. Keeping it a pure function
 * in the shared package is what makes those the same feature rather than three
 * implementations that disagree about a declined birthday.
 */

export type ReminderEvent = {
  id: string;
  title: string;
  start: Date;
  end: Date;
  isAllDay?: boolean;
  recurrence?: string | null;
  isCanceled?: boolean;
  /** Every calendar this event appears in. */
  calendars: string[];
};

export type ReminderContext = {
  /** IANA zone. Decides where an all-day reminder lands on the clock. */
  timezone: string;
  /** Bottom of the chain — there is nothing above it to inherit from. */
  defaultRule: ReminderRule;
  /** Calendar id → my rule for it. Missing means inherit. */
  calendarRules: Record<string, ReminderRule | undefined>;
  /** Event id → my override. Missing means inherit. */
  eventRules: Record<string, ReminderRule | undefined>;
  /** Event id → my answer. Only "declined" changes anything. */
  attendance?: Record<string, string | undefined>;
  /** My calendar order — settles which rule wins when an event is in several. */
  calendarOrder?: string[];
};

export type ResolvedReminder = {
  eventID: string;
  /** `${eventID}_${startMs}` — the id `expandRecurringEvents` already mints. */
  occurrenceID: string;
  occurrenceStart: Date;
  dueAt: Date;
  title: string;
  isAllDay: boolean;
};

const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 24 * 60 * MS_PER_MINUTE;

/**
 * The rule that applies to one event: override, then calendar, then default.
 *
 * The calendar step walks the user's own `calendarOrder` rather than inventing
 * a second priority. An event in both "Work" and "Everyone" has to pick one
 * answer, and the list the user already dragged into shape is the honest place
 * to read that from. A calendar whose rule says "never" wins there like any
 * other — saying nothing and saying no are different answers.
 */
export function resolveReminderRule(
  event: Pick<ReminderEvent, "id" | "calendars">,
  context: ReminderContext,
): ReminderRule {
  const override = context.eventRules[event.id];
  if (override) return override;

  const inEvent = new Set(event.calendars);
  const ordered = [
    ...(context.calendarOrder ?? []).filter((id) => inEvent.has(id)),
    // Calendars the user has never ordered still count; sorted so two devices
    // with the same data resolve the same rule.
    ...event.calendars
      .filter((id) => !(context.calendarOrder ?? []).includes(id))
      .sort(),
  ];

  for (const calendarID of ordered) {
    const rule = context.calendarRules[calendarID];
    if (rule) return rule;
  }

  return context.defaultRule;
}

/**
 * The instant an occurrence should be announced, or null for silence.
 *
 * All-day events are stored as UTC midnight of a timezone-invariant DATE (see
 * `eventDay`), so the reminder is built from that calendar date in the user's
 * zone — "the evening before at 18:00" has to mean their evening.
 */
export function reminderDueAt(
  occurrenceStart: Date,
  isAllDay: boolean,
  rule: ReminderRule,
  timezone: string,
): Date | null {
  if (!isAllDay) {
    if (rule.minutesBefore === null) return null;
    return new Date(occurrenceStart.getTime() - rule.minutesBefore * MS_PER_MINUTE);
  }

  if (rule.allDay === null) return null;
  const date = new Date(occurrenceStart.getTime() - rule.allDay.daysBefore * MS_PER_DAY);
  const hour = Math.floor(rule.allDay.atMinute / 60);
  const minute = rule.allDay.atMinute % 60;
  const wallClock = `${date.toISOString().slice(0, 10)}T${pad(hour)}:${pad(minute)}:00`;

  try {
    const resolved = dayjs.tz(wallClock, timezone);
    if (resolved.isValid()) return resolved.toDate();
  } catch {
    // `dayjs.tz` throws on a zone Intl does not know (a stale IANA name, a
    // client that sent nonsense). Falling back to UTC is wrong by hours; being
    // wrong by hours beats scheduling at NaN and silently never firing.
  }
  return new Date(`${wallClock}Z`);
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

/** How far past the window occurrences must be expanded for their reminders to land in it. */
function maxLeadMs(context: ReminderContext) {
  const rules = [
    context.defaultRule,
    ...Object.values(context.calendarRules),
    ...Object.values(context.eventRules),
  ];

  let lead = 0;
  for (const rule of rules) {
    if (!rule) continue;
    if (rule.minutesBefore !== null) {
      lead = Math.max(lead, rule.minutesBefore * MS_PER_MINUTE);
    }
    if (rule.allDay !== null) {
      // The wall-clock time can sit a whole extra day either side of the date.
      lead = Math.max(lead, (rule.allDay.daysBefore + 1) * MS_PER_DAY);
    }
  }
  return lead;
}

/**
 * Every reminder due in `[from, to]`, one entry per occurrence.
 *
 * The window is the DUE window, not the occurrence window: a caller asking
 * "what do I schedule for the next week" should not have to know that a rule
 * three levels up says "two days before".
 */
export function resolveReminders({
  context,
  events,
  from,
  to,
}: {
  context: ReminderContext;
  events: ReminderEvent[];
  from: Date;
  to: Date;
}): ResolvedReminder[] {
  const lead = maxLeadMs(context);
  const live = events.filter((event) => !event.isCanceled);
  // A declined event is an answer, and the answer was no.
  const wanted = live.filter(
    (event) => context.attendance?.[event.id] !== "declined",
  );

  const occurrences = expandRecurringEvents(
    wanted,
    from,
    new Date(to.getTime() + lead),
  );

  const reminders: ResolvedReminder[] = [];
  for (const occurrence of occurrences) {
    // Expansion rewrites the id of a series instance to `${masterID}_${startMs}`;
    // rules are keyed by the master, so strip the suffix before looking them up.
    const eventID = masterEventID(occurrence.id);
    const rule = resolveReminderRule(
      { id: eventID, calendars: occurrence.calendars },
      context,
    );
    const isAllDay = occurrence.isAllDay === true;
    const dueAt = reminderDueAt(occurrence.start, isAllDay, rule, context.timezone);
    if (!dueAt) continue;
    if (dueAt < from || dueAt > to) continue;

    reminders.push({
      eventID,
      occurrenceID: `${eventID}_${occurrence.start.getTime()}`,
      occurrenceStart: occurrence.start,
      dueAt,
      title: occurrence.title,
      isAllDay,
    });
  }

  return reminders.sort((left, right) => left.dueAt.getTime() - right.dueAt.getTime());
}

/** `"<uuid>_<ms>"` is one occurrence of `"<uuid>"`; anything else is already a master. */
export function masterEventID(id: string) {
  const separator = id.lastIndexOf("_");
  if (separator < 0) return id;
  const suffix = id.slice(separator + 1);
  return /^\d+$/.test(suffix) ? id.slice(0, separator) : id;
}
