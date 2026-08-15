import { resolveReminderRule } from "@musubi/calendar";
import type { ReminderRule, RemindersDocument } from "@musubi/types";

/**
 * Everything a surface needs to show and change one event's reminder.
 *
 * Passed as a single prop down the workspace rather than three, and optional
 * throughout: a story or a test that does not care about reminders should not
 * have to build a rules document to render an event.
 */
export type ReminderControl = {
  calendarOrder: readonly string[];
  document: RemindersDocument;
  /** `null` clears the override and puts the event back on its calendar's rule. */
  onChange: (eventId: string, rule: ReminderRule | null) => Promise<unknown>;
};

export type EventReminder = {
  /** True when this is the calendar's answer rather than the event's own. */
  inherited: boolean;
  rule: ReminderRule;
};

export function eventReminder(
  control: ReminderControl,
  event: { calendars?: readonly string[]; id: string },
): EventReminder {
  const context = {
    calendarOrder: [...control.calendarOrder],
    calendarRules: control.document.calendars,
    defaultRule: control.document.default,
    eventRules: control.document.events,
    // Only the rule is wanted here, never a due time — no zone is involved.
    timezone: "UTC",
  };

  return {
    inherited: control.document.events[event.id] === undefined,
    rule: resolveReminderRule(
      { calendars: [...(event.calendars ?? [])], id: event.id },
      context,
    ),
  };
}

/** Which calendar the inherited rule came from, for a label worth reading. */
export function inheritedFrom(
  control: ReminderControl,
  event: { calendars?: readonly string[] },
) {
  const inEvent = new Set(event.calendars ?? []);
  const ordered = [
    ...control.calendarOrder.filter((id) => inEvent.has(id)),
    ...[...inEvent].filter((id) => !control.calendarOrder.includes(id)).sort(),
  ];
  return ordered.find((id) => control.document.calendars[id]) ?? null;
}
