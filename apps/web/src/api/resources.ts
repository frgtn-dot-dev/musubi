import {
  CalendarsResponseSchema,
  EventsResponseSchema,
  RemoveEventResponseSchema,
  SettingsResponseSchema,
} from "./contracts";
import { EventSchema, type Event } from "@musubi/types";
import { apiRequest } from "./http";

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

export function getSettings(signal?: AbortSignal) {
  return apiRequest("/api/v1/users/settings", {
    responseSchema: SettingsResponseSchema,
    signal,
  });
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
