import {
  AttendeesResponseSchema,
  CalendarMembersResponseSchema,
  CalendarsResponseSchema,
  EventsResponseSchema,
  FederationConnectionsResponseSchema,
  ImportedCalendarSchema,
  InvitesResponseSchema,
  PageResponseSchema,
  PagesResponseSchema,
  RemoveEventResponseSchema,
  ServerCapabilitiesSchema,
  SettingsDocumentResponseSchema,
  SettingsResponseSchema,
} from "./contracts";
import {
  CalendarSchema,
  EventSchema,
  InviteSchema,
  type Calendar,
  type CreatePageRequest,
  type Event,
  type PatchSettingsRequest,
  type SavePageRequest,
} from "@musubi/types";
import { z } from "zod";
import {
  apiRawJsonRequest,
  apiRequest,
  apiTextRequest,
} from "./http";

/**
 * Route a request at a connected Musubi server instead of the home one.
 *
 * Passing a `connectionId` sends it through the home federation gateway, which
 * attaches the member token server-side (ADR-005) — the browser never holds a
 * cross-server credential, and the request stays same-origin.
 */
function route(
  connectionId: string | undefined,
  path: `/api/v1/${string}`,
): `/api/${string}` {
  return connectionId
    ? `/api/v1/federation/s/${connectionId}${path}`
    : path;
}

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

export function updateCalendar(calendar: Calendar, connectionId?: string) {
  return apiRequest(route(connectionId, "/api/v1/calendars"), {
    body: calendar,
    method: "PUT",
    responseSchema: CalendarSchema,
  });
}

export function removeCalendar(calendar: Calendar, connectionId?: string) {
  return apiRequest(route(connectionId, "/api/v1/calendars"), {
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

export function exportCalendar(calendarId: string, connectionId?: string) {
  return apiTextRequest(
    route(connectionId, `/api/v1/calendars/${calendarId}/export`),
  );
}

export function getCalendarMembers(
  calendarId: string,
  signal?: AbortSignal,
  connectionId?: string,
) {
  return apiRequest(
    route(connectionId, `/api/v1/calendars/${calendarId}/members`),
    { responseSchema: CalendarMembersResponseSchema, signal },
  );
}

export function getCalendarInvites(
  calendarId: string,
  signal?: AbortSignal,
  connectionId?: string,
) {
  return apiRequest(
    route(connectionId, `/api/v1/calendars/${calendarId}/invites`),
    { responseSchema: InvitesResponseSchema, signal },
  );
}

export function createInvite(
  input: {
    calendarID: string;
    expiresAt: Date | null;
    maxUses: number | null;
  },
  connectionId?: string,
) {
  return apiRequest(route(connectionId, "/api/v1/calendars/invites"), {
    // id/uses are server-assigned; the schema still requires them on the wire.
    body: { ...input, id: "new", uses: 0 },
    method: "POST",
    responseSchema: InviteSchema,
  });
}

export function revokeInvite(inviteId: string, connectionId?: string) {
  return apiRequest(
    route(connectionId, `/api/v1/calendars/invites/${inviteId}`),
    { method: "DELETE", responseSchema: z.void() },
  );
}

export function setMemberRole(
  calendarId: string,
  userId: string,
  role: string,
  connectionId?: string,
) {
  return apiRequest(
    route(connectionId, `/api/v1/calendars/${calendarId}/members/${userId}`),
    { body: { role }, method: "PUT", responseSchema: z.void() },
  );
}

export function kickMember(
  calendarId: string,
  userId: string,
  connectionId?: string,
) {
  return apiRequest(
    route(connectionId, `/api/v1/calendars/${calendarId}/members/${userId}`),
    { method: "DELETE", responseSchema: z.void() },
  );
}

export function leaveCalendar(calendarId: string, connectionId?: string) {
  return apiRequest(
    route(connectionId, `/api/v1/calendars/members/${calendarId}`),
    { method: "DELETE", responseSchema: z.void() },
  );
}

export function uploadAvatar(base64: string) {
  return apiRequest("/api/v1/users/avatar", {
    body: { data: base64 },
    method: "POST",
    responseSchema: z.object({ url: z.string() }),
  });
}

export function getFederationConnections(signal?: AbortSignal) {
  return apiRequest("/api/v1/federation/connections", {
    responseSchema: FederationConnectionsResponseSchema,
    signal,
  });
}

// Reads on a connected Musubi server go through the home gateway (ADR-005): the
// member token stays server-side, and the browser stays same-origin.
export function getFederatedCalendars(
  connectionId: string,
  signal?: AbortSignal,
) {
  return apiRequest(
    `/api/v1/federation/s/${connectionId}/api/v1/calendars`,
    { responseSchema: CalendarsResponseSchema, signal },
  );
}

export function getFederatedEvents(
  connectionId: string,
  signal?: AbortSignal,
) {
  return apiRequest(
    `/api/v1/federation/s/${connectionId}/api/v1/events`,
    { responseSchema: EventsResponseSchema, signal },
  );
}

export function getServerCapabilities(signal?: AbortSignal) {
  return apiRequest("/api/v1/server", {
    responseSchema: ServerCapabilitiesSchema,
    signal,
  });
}

export function connectCaldav(input: {
  password: string;
  serverUrl: string;
  username: string;
}) {
  return apiRequest("/api/v1/users/connections/caldav", {
    body: input,
    method: "POST",
    responseSchema: z.unknown(),
  });
}

// Federated servers are not provider accounts — they have their own connection
// record, so disconnecting one takes the origin rather than a provider+account.
export function disconnectFederatedServer(server: string) {
  return apiRequest("/api/v1/users/connections/musubi", {
    body: { server },
    method: "DELETE",
    responseSchema: z.unknown(),
  });
}

export function disconnectAccount(input: {
  accountId: string;
  provider: string;
}) {
  return apiRequest("/api/v1/users/connections/disconnect", {
    body: input,
    method: "POST",
    responseSchema: z.unknown(),
  });
}

export function deleteAccount() {
  // Starts the email-confirmed Better Auth deletion; the account is only
  // removed when the user opens the link we email them.
  return apiRequest("/api/v1/users", {
    method: "DELETE",
    responseSchema: z.void(),
  });
}

export function createEvent(event: Event, connectionId?: string) {
  return apiRequest(route(connectionId, "/api/v1/events"), {
    body: event,
    method: "POST",
    responseSchema: EventSchema,
  });
}

export function updateEvent(event: Event, connectionId?: string) {
  return apiRequest(route(connectionId, "/api/v1/events"), {
    body: event,
    method: "PUT",
    responseSchema: EventSchema,
  });
}

export function removeEvent(event: Event, connectionId?: string) {
  return apiRequest(route(connectionId, "/api/v1/events"), {
    body: event,
    method: "DELETE",
    responseSchema: RemoveEventResponseSchema,
  });
}

export function linkEvent(
  eventId: string,
  calendarId: string,
  connectionId?: string,
) {
  return apiRequest(route(connectionId, `/api/v1/events/${eventId}/link`), {
    body: { calendarID: calendarId },
    method: "POST",
    responseSchema: EventSchema,
  });
}

export function forkEvent(
  eventId: string,
  calendarId: string,
  connectionId?: string,
) {
  return apiRequest(route(connectionId, `/api/v1/events/${eventId}/fork`), {
    body: { calendarID: calendarId },
    method: "POST",
    responseSchema: EventSchema,
  });
}

export function getEventAttendees(
  eventId: string,
  signal?: AbortSignal,
  connectionId?: string,
) {
  return apiRequest(
    route(connectionId, `/api/v1/events/${eventId}/attendees`),
    { responseSchema: AttendeesResponseSchema, signal },
  );
}

export function setAttendance(
  eventId: string,
  attending: boolean,
  connectionId?: string,
) {
  return apiRequest(
    route(connectionId, `/api/v1/events/${eventId}/attendance`),
    {
      body: { attending },
      method: "PUT",
      responseSchema: AttendeesResponseSchema,
    },
  );
}
