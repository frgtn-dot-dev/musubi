import assert from "node:assert/strict";
import type { ReminderRule } from "@musubi/types";
import {
  masterEventID,
  reminderDueAt,
  resolveReminderRule,
  resolveReminders,
  type ReminderContext,
  type ReminderEvent,
} from "./reminders";

// Reminders fail in two directions and only one of them is loud. Sending one
// too many is a buzz in a meeting; sending none is the missed flight. So the
// silent cases — declined, cancelled, a calendar that says "never" — get as
// much attention here as the ones that fire.
//
// All-day assertions pin a zone explicitly rather than relying on the machine's,
// because "the evening before at 18:00" is the one rule whose answer moves when
// the reader does.

const AT_18 = { daysBefore: 1, atMinute: 18 * 60 };
const TEN_MINUTES: ReminderRule = { minutesBefore: 10, allDay: AT_18 };
const TWO_HOURS: ReminderRule = { minutesBefore: 120, allDay: AT_18 };
const NEVER: ReminderRule = { minutesBefore: null, allDay: null };

function context(overrides: Partial<ReminderContext> = {}): ReminderContext {
  return {
    timezone: "Europe/Prague",
    defaultRule: TEN_MINUTES,
    calendarRules: {},
    eventRules: {},
    ...overrides,
  };
}

function event(overrides: Partial<ReminderEvent> = {}): ReminderEvent {
  return {
    id: "event-1",
    title: "Standup",
    start: new Date("2026-08-20T09:00:00Z"),
    end: new Date("2026-08-20T09:30:00Z"),
    calendars: ["work"],
    ...overrides,
  };
}

/** All-day events are stored as UTC midnight of a timezone-invariant DATE. */
function allDay(date: string, overrides: Partial<ReminderEvent> = {}): ReminderEvent {
  return event({
    isAllDay: true,
    start: new Date(`${date}T00:00:00Z`),
    end: new Date(`${date}T00:00:00Z`),
    title: "Birthday",
    ...overrides,
  });
}

function due(events: ReminderEvent[], ctx: ReminderContext, from: string, to: string) {
  return resolveReminders({
    context: ctx,
    events,
    from: new Date(from),
    to: new Date(to),
  }).map((reminder) => reminder.dueAt.toISOString());
}

// ── Inheritance ───────────────────────────────────────────────────────────────

{
  // The whole chain, top to bottom, on one event.
  const ctx = context({
    calendarRules: { work: TWO_HOURS },
    eventRules: { "event-1": { minutesBefore: 5, allDay: AT_18 } },
  });
  assert.equal(resolveReminderRule(event(), ctx).minutesBefore, 5, "override wins");

  const withoutOverride = context({ calendarRules: { work: TWO_HOURS } });
  assert.equal(
    resolveReminderRule(event(), withoutOverride).minutesBefore,
    120,
    "calendar wins over the global default",
  );

  assert.equal(
    resolveReminderRule(event(), context()).minutesBefore,
    10,
    "global default when nothing else answers",
  );
}

{
  // An event in several calendars has to pick one answer. The user's own order
  // decides, and "never" is an answer like any other — otherwise a calendar
  // could only ever make somebody's phone louder, never quieter.
  const inBoth = event({ calendars: ["work", "holidays"] });

  const holidaysFirst = context({
    calendarOrder: ["holidays", "work"],
    calendarRules: { holidays: NEVER, work: TWO_HOURS },
  });
  assert.deepEqual(
    resolveReminderRule(inBoth, holidaysFirst),
    NEVER,
    "the first ordered calendar with a rule wins, even when it says never",
  );

  const workFirst = context({
    calendarOrder: ["work", "holidays"],
    calendarRules: { holidays: NEVER, work: TWO_HOURS },
  });
  assert.equal(resolveReminderRule(inBoth, workFirst).minutesBefore, 120);
}

{
  // A calendar the user has never dragged into shape still counts, and two
  // devices holding the same data must not disagree about which one won.
  const ctx = context({
    calendarOrder: [],
    calendarRules: { alpha: TWO_HOURS, zulu: { minutesBefore: 1, allDay: AT_18 } },
  });
  const inBoth = event({ calendars: ["zulu", "alpha"] });
  assert.equal(resolveReminderRule(inBoth, ctx).minutesBefore, 120, "sorted, not insertion order");
}

{
  // A calendar rule is skipped only when it is absent, not when it is silent.
  const ctx = context({ calendarRules: { work: undefined } });
  assert.equal(resolveReminderRule(event(), ctx).minutesBefore, 10);
}

// ── Never remind ──────────────────────────────────────────────────────────────

{
  const declined = context({ attendance: { "event-1": "declined" } });
  assert.deepEqual(due([event()], declined, "2026-08-01T00:00:00Z", "2026-08-31T00:00:00Z"), []);

  const going = context({ attendance: { "event-1": "going" } });
  assert.equal(
    due([event()], going, "2026-08-01T00:00:00Z", "2026-08-31T00:00:00Z").length,
    1,
    "any answer other than no still reminds",
  );
}

{
  const cancelled = [event({ isCanceled: true })];
  assert.deepEqual(
    due(cancelled, context(), "2026-08-01T00:00:00Z", "2026-08-31T00:00:00Z"),
    [],
  );
}

{
  const silent = context({ defaultRule: NEVER });
  assert.deepEqual(due([event()], silent, "2026-08-01T00:00:00Z", "2026-08-31T00:00:00Z"), []);
}

{
  // Already due. Scheduling this would fire the instant a client woke up and
  // announce a meeting that started an hour ago.
  assert.deepEqual(
    due([event()], context(), "2026-08-20T10:00:00Z", "2026-08-31T00:00:00Z"),
    [],
  );
}

// ── Timed events ──────────────────────────────────────────────────────────────

{
  assert.deepEqual(
    due([event()], context(), "2026-08-01T00:00:00Z", "2026-08-31T00:00:00Z"),
    ["2026-08-20T08:50:00.000Z"],
    "ten minutes before the start",
  );
}

{
  // The window is the DUE window: a reminder two hours ahead of an event just
  // outside it still belongs to the caller asking about the window.
  const ctx = context({ defaultRule: TWO_HOURS });
  assert.deepEqual(
    due([event()], ctx, "2026-08-20T06:00:00Z", "2026-08-20T08:00:00Z"),
    ["2026-08-20T07:00:00.000Z"],
    "occurrence sits past `to`, its reminder does not",
  );
}

// ── All-day events ────────────────────────────────────────────────────────────

{
  // The same birthday, two readers. Neither is woken at the other's 18:00.
  const prague = due(
    [allDay("2026-08-20")],
    context(),
    "2026-08-01T00:00:00Z",
    "2026-08-31T00:00:00Z",
  );
  assert.deepEqual(prague, ["2026-08-19T16:00:00.000Z"], "18:00 in Prague, summer");

  const newYork = due(
    [allDay("2026-08-20")],
    context({ timezone: "America/New_York" }),
    "2026-08-01T00:00:00Z",
    "2026-08-31T00:00:00Z",
  );
  assert.deepEqual(newYork, ["2026-08-19T22:00:00.000Z"], "18:00 in New York, summer");
}

{
  // Prague moves to summer time on 2026-03-29. Two birthdays a day apart get
  // reminders on either side of that, and a fixed offset would put one of them
  // an hour wrong — which is the whole reason the zone is stored per user.
  const beforeSwitch = due(
    [allDay("2026-03-29")],
    context(),
    "2026-03-01T00:00:00Z",
    "2026-03-31T00:00:00Z",
  );
  assert.deepEqual(beforeSwitch, ["2026-03-28T17:00:00.000Z"], "UTC+1");

  const afterSwitch = due(
    [allDay("2026-03-30")],
    context(),
    "2026-03-01T00:00:00Z",
    "2026-03-31T00:00:00Z",
  );
  assert.deepEqual(afterSwitch, ["2026-03-29T16:00:00.000Z"], "UTC+2");
}

{
  // An offset rule cannot answer for an all-day event and must not pretend to.
  const offsetOnly: ReminderRule = { minutesBefore: 10, allDay: null };
  assert.equal(reminderDueAt(new Date("2026-08-20T00:00:00Z"), true, offsetOnly, "UTC"), null);

  const allDayOnly: ReminderRule = { minutesBefore: null, allDay: AT_18 };
  assert.equal(reminderDueAt(new Date("2026-08-20T09:00:00Z"), false, allDayOnly, "UTC"), null);
}

{
  // Same morning, not the evening before.
  const sameDay: ReminderRule = { minutesBefore: null, allDay: { daysBefore: 0, atMinute: 9 * 60 } };
  const dueAt = reminderDueAt(new Date("2026-08-20T00:00:00Z"), true, sameDay, "Europe/Prague");
  assert.equal(dueAt?.toISOString(), "2026-08-20T07:00:00.000Z");
}

{
  // A zone this runtime cannot resolve must still produce a real instant —
  // wrong by hours beats a NaN that silently never fires.
  const dueAt = reminderDueAt(new Date("2026-08-20T00:00:00Z"), true, TEN_MINUTES, "Mars/Olympus");
  assert.ok(dueAt instanceof Date && !Number.isNaN(dueAt.getTime()));
}

// ── Recurring series ──────────────────────────────────────────────────────────

{
  // Rules are keyed by the master event, but expansion renames every instance.
  const series = event({ recurrence: "FREQ=DAILY;COUNT=3" });
  const ctx = context({ eventRules: { "event-1": TWO_HOURS } });
  const reminders = resolveReminders({
    context: ctx,
    events: [series],
    from: new Date("2026-08-19T00:00:00Z"),
    to: new Date("2026-08-31T00:00:00Z"),
  });

  assert.equal(reminders.length, 3, "one reminder per occurrence");
  assert.ok(
    reminders.every((reminder) => reminder.eventID === "event-1"),
    "the override was found despite the instance ids",
  );
  assert.equal(
    reminders[0]!.occurrenceID,
    `event-1_${reminders[0]!.occurrenceStart.getTime()}`,
  );
  assert.deepEqual(
    reminders.map((reminder) => reminder.dueAt.getTime()),
    [...reminders.map((reminder) => reminder.dueAt.getTime())].sort((a, b) => a - b),
    "sorted by when they fire",
  );
}

{
  assert.equal(masterEventID("abc_1755680400000"), "abc");
  assert.equal(masterEventID("abc"), "abc");
  // A real uuid contains no underscore, but a defensive split would maim an id
  // that happened to end in a word rather than a timestamp.
  assert.equal(masterEventID("abc_def"), "abc_def");
}

console.log("reminders.test.ts ok");
