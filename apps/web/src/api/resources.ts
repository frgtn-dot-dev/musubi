import {
  CalendarsResponseSchema,
  EventsResponseSchema,
  SettingsResponseSchema,
} from "./contracts";
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
