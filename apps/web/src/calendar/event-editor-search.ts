import { z } from "zod";
import type { EventFormValues } from "./event-form";
import { isCalendarView } from "./view-registry";

const optional = z.string().optional().catch(undefined);

/**
 * A full editor keeps its draft in the URL. Creation and editing deliberately
 * share this contract so "More options" never drops a field or changes how the
 * Back action restores the calendar.
 */
export const eventEditorSearchSchema = z.object({
  allDay: z.boolean().optional().catch(undefined),
  attendees: z.boolean().optional().catch(undefined),
  calendarId: optional,
  calendarIds: z.array(z.string()).optional().catch(undefined),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .catch(undefined),
  description: optional,
  endDate: optional,
  endTime: optional,
  location: optional,
  recurrence: optional,
  /**
   * Where the calendar was standing. This is separate from the event date so
   * Back never jumps the user to another week just because an event moved.
   */
  returnDate: optional,
  startTime: optional,
  title: optional,
  url: optional,
  view: z
    .string()
    .catch("month")
    .transform((value) => (isCalendarView(value) ? value : "month")),
});

export type EventEditorSearch = z.infer<typeof eventEditorSearchSchema>;

export function applyEventEditorSearch(
  base: EventFormValues,
  search: EventEditorSearch,
): EventFormValues {
  const calendarId = search.calendarId ?? base.calendarId;
  const requestedCalendars =
    search.calendarIds?.length ? search.calendarIds : base.calendarIds;
  const calendarIds = requestedCalendars.includes(calendarId)
    ? requestedCalendars
    : [calendarId, ...requestedCalendars];

  return {
    ...base,
    calendarId,
    calendarIds: Array.from(new Set(calendarIds)),
    date: search.date ?? base.date,
    description: search.description ?? base.description,
    endDate: search.endDate ?? base.endDate,
    endTime: search.endTime ?? base.endTime,
    hasAttendees: search.attendees ?? base.hasAttendees,
    isAllDay: search.allDay ?? base.isAllDay,
    location: search.location ?? base.location,
    recurrence: search.recurrence ?? base.recurrence,
    startTime: search.startTime ?? base.startTime,
    title: search.title ?? base.title,
    url: search.url ?? base.url,
  };
}
