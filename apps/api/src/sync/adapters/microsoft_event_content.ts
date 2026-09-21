import { z } from "zod";
import type { EventContentPatch } from "@musubi/db";
import { EventWriteError } from "@musubi/types";
import { ProviderEventWriteError, assertEventWriteEvidence, assertProviderEventMutationResponse, requireEventPatch } from "../event_write";
import { assertCompleteEventReadResponse } from "../event_create_identity";

const GRAPH = "https://graph.microsoft.com/v1.0";
const boundedSignal = (signal?: AbortSignal) => signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000);
const PREFER = 'outlook.timezone="UTC", outlook.body-content-type="text"';

/** Graph's native weak tag is accepted only by the proven personal-event PATCH
 * path. Never strip W/, synthesize it from changeKey, or use this for DELETE.
 * Evidence: docs/audits/outlook-event-cas-20260921.md. */
export function microsoftEventPatchEtag(value: unknown): string | null {
  return typeof value === "string" && /^W\/"[\x21\x23-\x7e\x80-\xff]+"$/.test(value) ? value : null;
}
function requireVersion(value: unknown) {
  const etag = microsoftEventPatchEtag(value);
  if (!etag) throw new ProviderEventWriteError("provider-version-unavailable");
  return etag;
}
export function refuseOutlookEventDelete(): never {
  throw new EventWriteError("event-write", "unsupported", "Delete this event in Outlook. Outlook does not protect deletion against concurrent changes. No changes were saved.");
}
function unsupported(): never {
  throw new EventWriteError("event-write", "unsupported", "Only the title, notes and location of personal, non-recurring Outlook events can be edited here. Make other changes in Outlook. No changes were saved.");
}
export function microsoftPersonalContentPatch(patch: EventContentPatch | undefined) {
  const diff = requireEventPatch(patch);
  if (Object.keys(diff).some(key => !["title", "description", "location", "color"].includes(key))) unsupported();
  const payload: Record<string, unknown> = {};
  if (diff.title !== undefined) {
    if (typeof diff.title !== "string") unsupported();
    payload.subject = diff.title;
  }
  for (const key of ["description", "location"] as const) {
    if (diff[key] !== undefined && diff[key] !== null && typeof diff[key] !== "string") unsupported();
  }
  if (diff.description !== undefined) payload.body = { contentType: "text", content: diff.description ?? "" };
  if (diff.location !== undefined) payload.location = { displayName: diff.location ?? "" };
  return payload;
}
function pathFor(calendarID: string, eventID: string) {
  if ([calendarID, eventID].some(id => !id || id.trim() !== id || [".", ".."].includes(id))) throw new ProviderEventWriteError("provider-conflict");
  return `/me/calendars/${encodeURIComponent(calendarID)}/events/${encodeURIComponent(eventID)}`;
}
export type MicrosoftContentSession = { token: string; calendarID: string; eventID: string; etag: string | null | undefined; signal?: AbortSignal; fetchImpl?: typeof fetch };
async function get(session: MicrosoftContentSession, path: string) {
  const response = await (session.fetchImpl ?? fetch)(`${GRAPH}${path}`, {
    headers: { Authorization: `Bearer ${session.token}`, Prefer: PREFER, "Cache-Control": "no-cache" },
    redirect: "error", signal: boundedSignal(session.signal),
  });
  assertCompleteEventReadResponse(response);
  return response.json();
}
export async function assertMicrosoftPersonalContent(session: MicrosoftContentSession) {
  const expected = requireVersion(session.etag);
  const path = pathFor(session.calendarID, session.eventID);
  const me = await get(session, "/me?$select=id,mail,userPrincipalName");
  const calendar = await get(session, `/me/calendars/${encodeURIComponent(session.calendarID)}?$select=id,canEdit,owner`);
  assertEventWriteEvidence(calendar.canEdit, "event-write");
  const self = me.mail ?? me.userPrincipalName;
  if (typeof me.id !== "string" || !me.id || !z.email().safeParse(self).success || calendar.id !== session.calendarID || typeof self !== "string" || !self || typeof calendar.owner?.address !== "string" || calendar.owner.address.toLowerCase() !== self.toLowerCase()) unsupported();
  const current = await get(session, path);
  if (current.id !== session.eventID || requireVersion(current["@odata.etag"]) !== expected) throw new ProviderEventWriteError("provider-conflict");
  // Complete native read, never a select/projection with omitted guest evidence.
  if (current.type !== "singleInstance" || current.isCancelled !== false || current.isOrganizer !== true || current.isDraft !== false || current.recurrence !== null || current.seriesMasterId != null || !Array.isArray(current.attendees) || current.attendees.length || current.isOnlineMeeting !== false || current.onlineMeeting != null || current.onlineMeetingUrl != null || current["@removed"] || current["@odata.nextLink"] || current["attendees@odata.nextLink"]) unsupported();
  return current;
}
export async function updateMicrosoftPersonalContent(session: MicrosoftContentSession, patch: EventContentPatch | undefined) {
  const payload = microsoftPersonalContentPatch(patch);
  const etag = requireVersion(session.etag);
  await assertMicrosoftPersonalContent(session);
  if (!Object.keys(payload).length) return;
  const response = await (session.fetchImpl ?? fetch)(`${GRAPH}${pathFor(session.calendarID, session.eventID)}`, {
    method: "PATCH", headers: { Authorization: `Bearer ${session.token}`, "Content-Type": "application/json", Prefer: PREFER, "If-Match": etag },
    body: JSON.stringify(payload), redirect: "error", signal: boundedSignal(session.signal),
  });
  assertProviderEventMutationResponse(response);
  if (response.status !== 200) throw new ProviderEventWriteError("provider-write-failed", "unconfirmed", response.status);
  const data = await response.json().catch(() => null);
  if (data?.id !== session.eventID) throw new ProviderEventWriteError("provider-write-failed", "unconfirmed", response.status);
  return { etag: microsoftEventPatchEtag(data["@odata.etag"]) };
}
