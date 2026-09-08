import type { Calendar } from "@musubi/types";

/** The current Graph calendarView is bounded, even when a displayed date is
 * empty. Keep that limitation visible for active Outlook event calendars. */
export function calendarCoverageNotice(calendars: readonly Pick<Calendar, "provider" | "supportsEvents">[]): string | null {
  return calendars.some(calendar => calendar.provider === "microsoft" && calendar.supportsEvents !== false)
    ? "Outlook sync covers a limited date range. Older and far-future events may not be loaded."
    : null;
}
