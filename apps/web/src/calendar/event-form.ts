import type { Event } from "@musubi/types";
import { toDateKey } from "./date-key";

export type EventFormValues = {
  calendarId: string;
  date: string;
  endTime: string;
  isAllDay: boolean;
  location: string;
  startTime: string;
  title: string;
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
): EventFormValues {
  const start = timedBoundary(date, startTime);
  const end = new Date(start.getTime() + 60 * 60 * 1_000);

  return {
    calendarId,
    date,
    endTime: toTimeInput(end),
    isAllDay: false,
    location: "",
    startTime,
    title: "",
  };
}

export function eventFormValues(event: Event): EventFormValues {
  return {
    calendarId: event.originCalendarID ?? event.calendars[0] ?? "",
    date: event.isAllDay
      ? allDayDateKey(event.start)
      : toDateKey(event.start),
    endTime: toTimeInput(event.end),
    isAllDay: event.isAllDay,
    location: event.location ?? "",
    startTime: toTimeInput(event.start),
    title: event.title,
  };
}

export function validateEventForm(values: EventFormValues) {
  if (!values.title.trim()) {
    return "Add an event title.";
  }

  if (!values.calendarId) {
    return "Choose a calendar.";
  }

  if (!values.date) {
    return "Choose a date.";
  }

  if (
    !values.isAllDay &&
    timedBoundary(values.date, values.endTime) <=
      timedBoundary(values.date, values.startTime)
  ) {
    return "End time must be after start time.";
  }

  return null;
}

function eventBoundaries(values: EventFormValues) {
  return values.isAllDay
    ? {
        end: allDayBoundary(values.date),
        start: allDayBoundary(values.date),
      }
    : {
        end: timedBoundary(values.date, values.endTime),
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
    calendars: [values.calendarId],
    color,
    creatorID: identity.userId,
    description: null,
    end: boundaries.end,
    hasAttendees: false,
    id: crypto.randomUUID(),
    isAllDay: values.isAllDay,
    isCanceled: false,
    location: values.location.trim() || null,
    organizer: identity.email,
    originCalendarID: values.calendarId,
    recurrence: null,
    start: boundaries.start,
    title: values.title.trim(),
    url: null,
  };
}

export function updateEventFromForm(
  event: Event,
  values: EventFormValues,
): Event {
  const boundaries = eventBoundaries(values);

  return {
    ...event,
    end: boundaries.end,
    isAllDay: values.isAllDay,
    location: values.location.trim() || null,
    start: boundaries.start,
    title: values.title.trim(),
  };
}
