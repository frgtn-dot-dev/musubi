import { editedEvent, type Event, type EventWriteRequest } from "@musubi/types";
import { toDateKey } from "./date-key";
import {
  spansMultipleServers,
  type ConnectionMap,
} from "./federation-routing";

export type EventFormValues = {
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
  return new Date(
    Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1),
  );
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
  }: { endDate?: string; endTime?: string; isAllDay?: boolean } = {},
): EventFormValues {
  const start = timedBoundary(date, startTime);
  const end = new Date(start.getTime() + 60 * 60 * 1_000);

  return {
    calendarId,
    calendarIds: [calendarId],
    date,
    description: "",
    endDate: endDate ?? date,
    endTime: endTime ?? toTimeInput(end),
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

  if (!values.date) {
    return "Choose a date.";
  }

  if (
    values.isAllDay &&
    allDayBoundary(values.endDate) < allDayBoundary(values.date)
  ) {
    return "End date must be on or after the start date.";
  }

  if (!values.isAllDay) {
    const start = timedBoundary(values.date, values.startTime).getTime();
    const end = timedBoundary(values.endDate, values.endTime).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      return "End time must be after start time.";
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

function eventBoundaries(values: EventFormValues) {
  return values.isAllDay
    ? {
        end: allDayBoundary(values.endDate),
        start: allDayBoundary(values.date),
      }
    : {
        end: timedBoundary(values.endDate, values.endTime),
        start: timedBoundary(values.date, values.startTime),
      };
}

export function createEventFromForm(
  values: EventFormValues,
  identity: NewEventIdentity,
  color: string,
): Event {
  const boundaries = eventBoundaries(values);

  return {
    calendars: values.calendarIds,
    color,
    creatorID: identity.userId,
    description: values.description.trim() || null,
    end: boundaries.end,
    hasAttendees: values.hasAttendees,
    id: crypto.randomUUID(),
    isAllDay: values.isAllDay,
    isCanceled: false,
    location: values.location.trim() || null,
    organizer: identity.email,
    originCalendarID: values.calendarId,
    recurrence: values.recurrence || null,
    start: boundaries.start,
    title: values.title.trim(),
    url: values.url.trim() || null,
  };
}

export function updateEventFromForm(
  event: Event,
  values: EventFormValues,
): EventWriteRequest {
  const boundaries = eventBoundaries(values);

  const original = eventFormValues(event);
  return editedEvent(event, {
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
  });
}
