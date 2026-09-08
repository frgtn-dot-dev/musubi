import { expandRecurringEvents, type ICalendarEventBase } from "@musubi/calendar";

export const CALENDAR_EXPANSION_ERROR =
  "Some event times or recurrence rules could not be displayed. Refresh calendars or update Musubi and try again. Your saved events have not changed.";

/** A complete view or an explicit error; never present a partially expanded family. */
export function expandCalendarView<T extends ICalendarEventBase>(
  events: T[],
  start: Date,
  end: Date,
  options: Parameters<typeof expandRecurringEvents>[3],
): { events: T[]; error: string | null } {
  try {
    return {
      events: expandRecurringEvents(events, start, end, options).sort(
        (a, b) => a.start.getTime() - b.start.getTime(),
      ),
      error: null,
    };
  } catch {
    return { events: [], error: CALENDAR_EXPANSION_ERROR };
  }
}
