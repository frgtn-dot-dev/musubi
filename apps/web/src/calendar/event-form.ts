import { EventTimeZoneSchema, editedEvent, type Event, type EventWriteRequest } from "@musubi/types";
import { instantToCivil, unambiguousCivilToInstant, knownEventTimeDraft, editEventTimeDraft, createEventTimeDraft, type EventTimeDraft } from "@musubi/calendar";
import { toDateKey } from "./date-key";
import { spansMultipleServers, type ConnectionMap } from "./federation-routing";

export type ExactEventRange = { start: Date; end: Date };

export type EventFormValues = {
  /** Exact slot selected on the grid, retained while its civil fields are unchanged. */
  exactRange?: ExactEventRange;
  /** Civil edits revoke only the edited endpoint’s selected occurrence. */
  invalidatedExactEndpoints?: ("start" | "end")[];
  /** Authored private fields carried between editor surfaces, never sent as event content. */
  privateDraftFields?: ("title" | "description" | "location" | "url")[];
  /** Stable creation identity for this draft, including retries and handoff. */
  createID?: string;
  timeLabel?: string;
  timeKind?: EventTimeDraft["timeKind"];
  timeZone?: string;
  timeEditable?: boolean;
  calendarId: string;
  calendarIds: string[];
  date: string;
  description: string;
  endDate: string;
  endTime: string;
  hasAttendees: boolean;
  isAllDay: boolean;
  location: string;
  recurrence: string;
  startTime: string;
  title: string;
  url: string;
};

export type HomeCalendarChange = Pick<
  EventFormValues,
  "calendarId" | "calendarIds"
> & {
  removedCalendarCount: number;
};

type NewEventIdentity = {
  email: string;
  userId: string;
};

function toTimeInput(date: Date) {
  return `${String(date.getHours()).padStart(2, "0")}:${String(
    date.getMinutes(),
  ).padStart(2, "0")}`;
}

function allDayDateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function timedBoundary(date: string, time: string) {
  return new Date(`${date}T${time}:00`);
}

function allDayBoundary(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1));
}

export function defaultEventFormValues(
  calendarId: string,
  date: string,
  startTime = "12:00",
  /**
   * What a gesture derived. Dragging a time interval gives `endTime`; dragging
   * across days in the month grid gives an all-day range. A plain click gives
   * neither and falls back to a one-hour timed event.
   */
  {
    endDate,
    endTime,
    isAllDay = false,
    exactRange,
  }: { endDate?: string; endTime?: string; isAllDay?: boolean; exactRange?: ExactEventRange } = {},
): EventFormValues {
  const start = timedBoundary(date, startTime);
  const end = new Date(start.getTime() + 60 * 60 * 1_000);

  return {
    exactRange,
    createID: crypto.randomUUID(),
    timeEditable: true,
    timeKind: "legacy-unknown",
    calendarId,
    calendarIds: [calendarId],
    date,
    description: "",
    endDate: endDate ?? (exactRange ? toDateKey(exactRange.end) : date),
    endTime: endTime ?? toTimeInput(exactRange?.end ?? end),
    hasAttendees: false,
    isAllDay,
    location: "",
    recurrence: "",
    startTime,
    title: "",
    url: "",
  };
}

export function eventFormValues(event: Event): EventFormValues {
  const known = knownEventTimeDraft(event);
  return {
    calendarId: event.originCalendarID ?? event.calendars[0] ?? "",
    calendarIds: event.calendars,
    date: event.isAllDay ? allDayDateKey(event.start) : toDateKey(event.start),
    description: event.description ?? "",
    endDate: event.isAllDay ? allDayDateKey(event.end) : toDateKey(event.end),
    endTime: toTimeInput(event.end),
    hasAttendees: event.hasAttendees,
    isAllDay: event.isAllDay,
    location: event.location ?? "",
    recurrence: event.recurrence ?? "",
    startTime: toTimeInput(event.start),
    title: event.title,
    url: event.url ?? "",
    timeEditable: true,
    timeKind: "legacy-unknown",
    ...(!known && !event.isAllDay ? { exactRange: { start: event.start, end: event.end } } : {}),
    ...(known ?? {}),
  };
}

export function validateEventForm(
  values: EventFormValues,
  // Optional so callers without federated calendars stay unchanged.
  connections?: ConnectionMap,
) {
  if (!values.title.trim()) {
    return "Add an event title.";
  }

  if (!values.calendarId || !values.calendarIds.includes(values.calendarId)) {
    return "Choose a calendar.";
  }

  // Each server only knows its own calendars, so a cross-server event would
  // silently lose the other side's links.
  if (connections && spansMultipleServers(connections, values.calendarIds)) {
    return "These calendars live on different servers. Pick calendars from one server.";
  }

  if (values.timeKind === "zoned" && !EventTimeZoneSchema.safeParse(values.timeZone?.trim() ?? "").success)
    return "Enter a valid event time zone, for example Europe/Prague.";

  if (!values.date) {
    return "Choose a date.";
  }

  if (
    values.isAllDay &&
    allDayBoundary(values.endDate) < allDayBoundary(values.date)
  ) {
    return "End date must be on or after the start date.";
  }

  if (!values.isAllDay && !(values.timeKind && values.timeKind !== "legacy-unknown")) {
    try {
      const { start, end } = eventBoundaries(values);
      if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start)
        return "End time must be after start time.";
    } catch (error) {
      return error instanceof Error ? error.message : "Choose a valid time.";
    }
  }

  return null;
}

/**
 * A home switch is also a server-routing decision. If the draft only contains
 * its old home, the new home replaces it. Once the user has deliberately added
 * more calendars, keep every selected calendar from the new home's server and
 * discard memberships that the receiving server could not persist.
 */
export function selectHomeCalendar(
  values: Pick<EventFormValues, "calendarId" | "calendarIds">,
  calendarId: string,
  serverForCalendar: (calendarId: string) => string,
): HomeCalendarChange {
  const nextServer = serverForCalendar(calendarId);
  const replacingOnlyHome =
    values.calendarIds.length === 1 &&
    values.calendarIds[0] === values.calendarId;
  const calendarsOnNextServer = replacingOnlyHome
    ? []
    : values.calendarIds.filter(
        (selectedId) => serverForCalendar(selectedId) === nextServer,
      );
  const calendarIds = Array.from(
    new Set([calendarId, ...calendarsOnNextServer]),
  );

  return {
    calendarId,
    calendarIds,
    removedCalendarCount: values.calendarIds.filter(
      (selectedId) => !calendarIds.includes(selectedId),
    ).length,
  };
}

function legacyBoundary(values: EventFormValues, endpoint: "start" | "end") {
  const date = endpoint === "start" ? values.date : values.endDate;
  const time = endpoint === "start" ? values.startTime : values.endTime;
  if (!Number.isFinite(timedBoundary(date, time).getTime()))
    throw new Error("End time must be after start time.");
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const chosen = values.invalidatedExactEndpoints?.includes(endpoint) ? undefined : values.exactRange?.[endpoint];
  if (chosen && instantToCivil(chosen, zone).slice(0, 16) === `${date}T${time}`)
    return chosen;
  try {
    return unambiguousCivilToInstant(`${date}T${time}:00.000`, zone);
  } catch {
    throw new Error("This local time is missing or occurs twice because the clocks change. Choose an exact time on the calendar grid, or enter a different time.");
  }
}

export function eventBoundaries(values: EventFormValues) {
  return values.isAllDay
    ? {
        end: allDayBoundary(values.endDate),
        start: allDayBoundary(values.date),
      }
    : {
        end: values.timeKind && values.timeKind !== "legacy-unknown" ? timedBoundary(values.endDate, values.endTime) : legacyBoundary(values, "end"),
        start: values.timeKind && values.timeKind !== "legacy-unknown" ? timedBoundary(values.date, values.startTime) : legacyBoundary(values, "start"),
      };
}

export function createEventFromForm(
  values: EventFormValues,
  identity: NewEventIdentity,
  color: string,
): EventWriteRequest {
  const boundaries = eventBoundaries(values);

  return createEventTimeDraft({
    calendars: values.calendarIds,
    color,
    creatorID: identity.userId,
    description: values.description.trim() || null,
    end: boundaries.end,
    hasAttendees: values.hasAttendees,
    id: values.createID ?? crypto.randomUUID(),
    isAllDay: values.isAllDay,
    isCanceled: false,
    location: values.location.trim() || null,
    organizer: identity.email,
    originCalendarID: values.calendarId,
    recurrence: values.recurrence || null,
    start: boundaries.start,
    title: values.title.trim(),
    url: values.url.trim() || null,
  }, values);
}

export function updateEventFromForm(
  event: Event,
  values: EventFormValues,
): EventWriteRequest {
  const boundaries = eventBoundaries(values);

  const original = eventFormValues(event);
  const edited = {
    ...event,
    calendars: values.calendarIds,
    description: values.description === original.description
      ? event.description : values.description.trim() || null,
    end:
      values.endDate === original.endDate &&
      values.endTime === original.endTime &&
      values.isAllDay === original.isAllDay
        ? event.end
        : boundaries.end,
    hasAttendees: values.hasAttendees,
    isAllDay: values.isAllDay,
    location: values.location === original.location
      ? event.location : values.location.trim() || null,
    recurrence: values.recurrence === original.recurrence
      ? event.recurrence : values.recurrence || null,
    start:
      values.date === original.date &&
      values.startTime === original.startTime &&
      values.isAllDay === original.isAllDay
        ? event.start
        : boundaries.start,
    title: values.title === original.title ? event.title : values.title.trim(),
    url: values.url === original.url ? event.url : values.url.trim() || null,
  };
  return knownEventTimeDraft(event) || (values.timeKind && values.timeKind !== "legacy-unknown")
    ? editEventTimeDraft(event, edited, values)
    : editedEvent(event, edited);
}
