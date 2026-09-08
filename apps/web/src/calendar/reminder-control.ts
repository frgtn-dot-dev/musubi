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
  /** A failed resolution cancels local timers and is shown by the workspace. */
  error?: Error;
  retry?: () => Promise<void>;
  calendarOrder: readonly string[];
  document: RemindersDocument;
  /** Web push for THIS browser. Absent capability hides the choice entirely. */
  push: {
    available: boolean;
    enabled: boolean;
    /** Resolves to whether it ended up on — a denied prompt returns false. */
    set: (wanted: boolean) => Promise<boolean>;
  };
  /** `null` restores inheritance from the series, calendar or default. */
  onChange: (eventId: string, rule: ReminderRule | null) => Promise<unknown>;
  /** `null` puts the calendar back on the global default. */
  onCalendarChange: (
    calendarId: string,
    rule: ReminderRule | null,
  ) => Promise<unknown>;
};

export type EventReminder = {
  /** True when the event inherits its rule instead of having its own override. */
  inherited: boolean;
  rule: ReminderRule;
};

export function eventReminder(
  control: ReminderControl,
  event: { calendars?: readonly string[]; id: string; seriesID?: string | null },
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
      { calendars: [...(event.calendars ?? [])], id: event.id, seriesID: event.seriesID },
      context,
    ),
  };
}

/** Remove only this event's override; a detached event still follows its series. */
export function inheritedEventReminder(
  control: ReminderControl,
  event: Parameters<typeof eventReminder>[1],
): EventReminder {
  const events = { ...control.document.events };
  delete events[event.id];
  return eventReminder({ ...control, document: { ...control.document, events } }, event);
}
