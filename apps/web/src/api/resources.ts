import {
  AttendeesResponseSchema,
  CalendarsResponseSchema,
  EventsResponseSchema,
  ImportedCalendarSchema,
  PageResponseSchema,
  PagesResponseSchema,
  RemoveEventResponseSchema,
  SettingsDocumentResponseSchema,
  SettingsResponseSchema,
} from "./contracts";
import {
  CalendarSchema,
  EventSchema,
  type Calendar,
  type CreatePageRequest,
  type Event,
  type PatchSettingsRequest,
  type SavePageRequest,
} from "@musubi/types";
import {
  apiRawJsonRequest,
  apiRequest,
  apiTextRequest,
} from "./http";

export function getCalendars(signal?: AbortSignal) {
  return apiRequest("/api/v1/calendars", {
    responseSchema: CalendarsResponseSchema,
    signal,
  });
}

export function getEvents(signal?: AbortSignal) {
  return apiRequest("/api/v1/events", {
    responseSchema: EventsResponseSchema,
    signal,
  });
}

export function getPages(signal?: AbortSignal) {
  return apiRequest("/api/v1/pages", {
    responseSchema: PagesResponseSchema,
    signal,
  });
}

export function createPage(request: CreatePageRequest) {
  return apiRequest("/api/v1/pages", {
    body: request,
    method: "POST",
    responseSchema: PageResponseSchema,
  });
}

export function savePage(id: string, request: SavePageRequest) {
  return apiRequest(`/api/v1/pages/${id}`, {
    body: request,
    method: "PATCH",
    responseSchema: PageResponseSchema,
  });
}

export function getSettings(signal?: AbortSignal) {
  return apiRequest("/api/v1/users/settings", {
    responseSchema: SettingsResponseSchema,
    signal,
  });
}

export function getSettingsDocument(signal?: AbortSignal) {
  return apiRequest("/api/v1/users/settings/document", {
    responseSchema: SettingsDocumentResponseSchema,
    signal,
  });
}

export function patchSettings(request: PatchSettingsRequest) {
  return apiRequest("/api/v1/users/me/settings", {
    body: request,
    method: "PATCH",
    responseSchema: SettingsDocumentResponseSchema,
  });
}

export function createCalendar(calendar: Calendar) {
  return apiRequest("/api/v1/calendars", {
    body: calendar,
    method: "POST",
    responseSchema: CalendarSchema,
  });
}

export function updateCalendar(calendar: Calendar) {
  return apiRequest("/api/v1/calendars", {
    body: calendar,
    method: "PUT",
    responseSchema: CalendarSchema,
  });
}

export function removeCalendar(calendar: Calendar) {
  return apiRequest("/api/v1/calendars", {
    body: calendar,
    method: "DELETE",
    responseSchema: CalendarSchema,
  });
}

export function importCalendar(
  ics: string,
  name: string,
  color: string,
) {
  const query = new URLSearchParams({ color, name });
  return apiRawJsonRequest(
    `/api/v1/calendars/import?${query.toString()}`,
    {
      body: ics,
      contentType: "text/calendar",
      responseSchema: ImportedCalendarSchema,
    },
  );
}

export function exportCalendar(calendarId: string) {
  return apiTextRequest(`/api/v1/calendars/${calendarId}/export`);
}

export function createEvent(event: Event) {
  return apiRequest("/api/v1/events", {
    body: event,
    method: "POST",
    responseSchema: EventSchema,
  });
}

export function updateEvent(event: Event) {
  return apiRequest("/api/v1/events", {
    body: event,
    method: "PUT",
    responseSchema: EventSchema,
  });
}

export function removeEvent(event: Event) {
  return apiRequest("/api/v1/events", {
    body: event,
    method: "DELETE",
    responseSchema: RemoveEventResponseSchema,
  });
}

export function linkEvent(eventId: string, calendarId: string) {
  return apiRequest(`/api/v1/events/${eventId}/link`, {
    body: { calendarID: calendarId },
    method: "POST",
    responseSchema: EventSchema,
  });
}

export function forkEvent(eventId: string, calendarId: string) {
  return apiRequest(`/api/v1/events/${eventId}/fork`, {
    body: { calendarID: calendarId },
    method: "POST",
    responseSchema: EventSchema,
  });
}

export function getEventAttendees(
  eventId: string,
  signal?: AbortSignal,
) {
  return apiRequest(`/api/v1/events/${eventId}/attendees`, {
    responseSchema: AttendeesResponseSchema,
    signal,
  });
}

export function setAttendance(eventId: string, attending: boolean) {
  return apiRequest(`/api/v1/events/${eventId}/attendance`, {
    body: { attending },
    method: "PUT",
    responseSchema: AttendeesResponseSchema,
  });
}
