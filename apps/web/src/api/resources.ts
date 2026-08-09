import {
  AttendeesResponseSchema,
  CalendarMembersResponseSchema,
  CalendarsResponseSchema,
  EventRsvpsSchema,
  EventShareSchema,
  EventsResponseSchema,
  FederationConnectionsResponseSchema,
  ImportedCalendarSchema,
  InvitePreviewSchema,
  InvitesResponseSchema,
  PageResponseSchema,
  PagesResponseSchema,
  PollSchema,
  PollSummarySchema,
  PublicEventSchema,
  RemoveEventResponseSchema,
  RsvpSummarySchema,
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
  type ReorderPagesRequest,
  type SavePageRequest,
} from "@musubi/types";
import type { EventPageTheme } from "@musubi/types";
import type { RsvpStatus, VoteValue } from "./contracts";
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

export function getEvents(
  range?: { end: Date; start: Date },
  signal?: AbortSignal,
) {
  const search = range
    ? `?${new URLSearchParams({
        start: range.start.toISOString(),
        end: range.end.toISOString(),
      })}`
    : "";
  return apiRequest(`/api/v1/events${search}`, {
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

export function reorderPages(request: ReorderPagesRequest) {
  return apiRequest("/api/v1/pages/reorder", {
    body: request,
    method: "PUT",
    responseSchema: PagesResponseSchema,
  });
}

export function deletePage(id: string) {
  return apiRequest(`/api/v1/pages/${id}`, {
    method: "DELETE",
    responseSchema: z.object({ id: z.string() }),
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
  provider?: string,
  accountId?: string,
) {
  const query = new URLSearchParams({ color, name });
  if (provider && accountId) {
    query.set("provider", provider);
    query.set("accountId", accountId);
  }
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

/** Invite preview on this server (the token is the capability — no session needed). */
export function getInvitePreview(token: string, signal?: AbortSignal) {
  return apiRequest(`/api/v1/calendars/tokens/${token}`, {
    responseSchema: InvitePreviewSchema,
    signal,
  });
}

/** Join a calendar on this server. */
export function joinCalendar(calendarId: string, token: string) {
  return apiRequest(`/api/v1/calendars/members/${calendarId}`, {
    body: { token },
    method: "POST",
    responseSchema: z.unknown(),
  });
}

// Cross-server invites: the home server previews and accepts on our behalf, so
// the member token it receives never reaches the browser (ADR-005).
export function getFederatedInvitePreview(
  server: string,
  token: string,
  signal?: AbortSignal,
) {
  const query = new URLSearchParams({ server, token });
  return apiRequest(`/api/v1/federation/preview?${query.toString()}`, {
    responseSchema: InvitePreviewSchema,
    signal,
  });
}

export function connectFederatedServer(server: string, token: string) {
  return apiRequest("/api/v1/federation/connect", {
    body: { server, token },
    method: "POST",
    responseSchema: z.object({ server: z.string() }).loose(),
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

export function getEventShare(eventId: string, signal?: AbortSignal) {
  return apiRequest(`/api/v1/events/${eventId}/share`, {
    responseSchema: EventShareSchema.nullable(),
    signal,
  });
}

export function publishEvent(input: {
  attendeeVisibility: "counts" | "hidden" | "names";
  eventId: string;
  indexable: boolean;
  mode: "link" | "public";
  /** Names an account that has none yet — a page made from /new-event. */
  name?: string;
  theme: EventPageTheme;
}) {
  return apiRequest(`/api/v1/events/${input.eventId}/share`, {
    body: {
      attendeeVisibility: input.attendeeVisibility,
      indexable: input.indexable,
      mode: input.mode,
      name: input.name,
      theme: input.theme,
    },
    method: "PUT",
    responseSchema: EventShareSchema,
  });
}

export function unpublishEvent(eventId: string) {
  return apiRequest(`/api/v1/events/${eventId}/share`, {
    method: "DELETE",
    responseSchema: z.unknown(),
  });
}

/** The public page's own read. No session, and none needed. */
export function getPublicEvent(token: string, signal?: AbortSignal) {
  return apiRequest(`/api/v1/public/events/${token}`, {
    responseSchema: PublicEventSchema,
    signal,
  });
}

/** Every answer, for the organizer. Ignores the reader-facing visibility. */
export function getEventRsvps(eventId: string, signal?: AbortSignal) {
  return apiRequest(`/api/v1/events/${eventId}/rsvps`, {
    responseSchema: EventRsvpsSchema,
    signal,
  });
}

/** The reader's own answer and the counts, once they have a session. */
export function getEventRsvp(token: string, signal?: AbortSignal) {
  return apiRequest(`/api/v1/public/events/${token}/rsvp`, {
    responseSchema: RsvpSummarySchema,
    signal,
  });
}

export function answerEvent(input: {
  name?: string;
  status: RsvpStatus;
  token: string;
}) {
  return apiRequest(`/api/v1/public/events/${input.token}/rsvp`, {
    body: { name: input.name, status: input.status },
    method: "PUT",
    responseSchema: RsvpSummarySchema,
  });
}

// ── Scheduling ───────────────────────────────────────────────────────────────

export function getPolls(signal?: AbortSignal) {
  return apiRequest("/api/v1/scheduling/polls", {
    responseSchema: z.array(PollSummarySchema),
    signal,
  });
}

export function createPoll(input: {
  /** When answers stop being taken, if the organizer set a date. */
  deadline?: string;
  description?: string;
  /** Names an account that has none yet — a poll made from the public page. */
  name?: string;
  slots: Array<{ start: string }>;
  title: string;
}) {
  return apiRequest("/api/v1/scheduling/polls", {
    body: input,
    method: "POST",
    responseSchema: PollSummarySchema,
  });
}

/** Open by token — reading a poll needs no session, answering does. */
export function getPoll(token: string, signal?: AbortSignal) {
  return apiRequest(`/api/v1/public/polls/${token}`, {
    responseSchema: PollSchema,
    signal,
  });
}

export function votePoll(input: {
  /** Only for somebody who arrived by link: it names their empty account. */
  name?: string;
  token: string;
  votes: Array<{ slotID: string; value: VoteValue }>;
}) {
  return apiRequest(`/api/v1/public/polls/${input.token}/votes`, {
    body: { name: input.name, votes: input.votes },
    method: "PUT",
    responseSchema: PollSchema,
  });
}

export function decidePoll(input: {
  calendarId: string;
  pollId: string;
  slotId: string;
}) {
  return apiRequest(`/api/v1/scheduling/polls/${input.pollId}/decide`, {
    body: { calendarId: input.calendarId, slotId: input.slotId },
    method: "POST",
    responseSchema: z.object({ eventId: z.string(), slotId: z.string() }),
  });
}

/** Stop taking answers without picking a time. The poll stays readable. */
export function closePoll(pollId: string) {
  return apiRequest(`/api/v1/scheduling/polls/${pollId}/close`, {
    body: {},
    method: "POST",
    responseSchema: z.object({ closed: z.boolean() }),
  });
}

/** Removes the poll and every answer on it. Any event a decision made stays. */
export function deletePoll(pollId: string) {
  return apiRequest(`/api/v1/scheduling/polls/${pollId}`, {
    method: "DELETE",
    responseSchema: z.unknown(),
  });
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

/**
 * Pull in the calendars of every provider account this user has connected.
 *
 * The endpoint is named after Google for historical reasons; it runs the sync
 * engine for the whole user, which is what a freshly linked account needs. The
 * background scheduler does the same thing every few minutes — this is how the
 * person who just linked something does not have to wait for it.
 */
export function syncProviderCalendars(signal?: AbortSignal) {
  return apiRequest("/api/v1/calendars/google", {
    responseSchema: z.unknown(),
    signal,
    // Talking to Google or Microsoft for every calendar takes longer than a
    // normal read, and giving up early would leave a half-imported account.
    timeoutMs: 60_000,
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

export function disconnectExternalCalendar(calendarId: string) {
  return apiRequest(
    "/api/v1/users/connections/calendars/disconnect",
    {
      body: { calendarId },
      method: "POST",
      responseSchema: z.object({ id: z.string() }),
    },
  );
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
