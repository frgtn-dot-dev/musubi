import { isDeepStrictEqual } from "node:util";
import { createHash } from "node:crypto";
import { z } from "zod";
import { type ProviderRsvpEdit, microsoftRsvpDesiredState } from "@musubi/types";
import { resolveEventTimeEdit } from "@musubi/calendar";
import { microsoftEventState } from "./provider_event_state";
import { ProviderEventWriteError } from "../event_write";

const address = z.object({ emailAddress: z.object({ address: z.email(), name: z.string().optional() }).passthrough() }).passthrough();
const responseStatus = z.object({ response: z.enum(["accepted", "tentativelyAccepted", "declined", "notResponded", "none"]), time: z.iso.datetime({ offset: true }).optional() }).passthrough();
const nativeSchema = z.object({
  id: z.string().min(1), iCalUId: z.string().min(1), "@odata.etag": z.string().min(1),
  changeKey: z.string().min(1).optional(), lastModifiedDateTime: z.iso.datetime({ offset: true }).optional(),
  type: z.literal("singleInstance"), isCancelled: z.literal(false), isOrganizer: z.literal(false), isDraft: z.literal(false),
  recurrence: z.null(), seriesMasterId: z.null().optional(), originalStart: z.never().optional(),
  "@removed": z.never().optional(), "@odata.nextLink": z.never().optional(), "attendees@odata.nextLink": z.never().optional(),
  attendees: z.array(address.extend({ type: z.enum(["required", "optional", "resource"]), status: responseStatus })).min(1).max(200),
  organizer: address, responseStatus, subject: z.string(), body: z.object({ contentType: z.literal("text"), content: z.string() }),
  location: z.object({ displayName: z.string() }).passthrough(),
}).passthrough();
export type MicrosoftRsvpEvidence = { id: string; etag: string; selfAddress: string; response: ProviderRsvpEdit["response"]; native: Record<string, unknown> };
const fail = (): never => { throw new ProviderEventWriteError("provider-conflict"); };
export function microsoftRsvpEvidence(input: unknown, selfAddress: string, response: ProviderRsvpEdit["response"]): MicrosoftRsvpEvidence {
  const native = nativeSchema.parse(structuredClone(input));
  const own = selfAddress.toLowerCase();
  const self = native.attendees.filter(a => a.emailAddress.address.toLowerCase() === own);
  if (self.length !== 1 || self[0]!.type === "resource" || native.organizer.emailAddress.address.toLowerCase() === own || native.attendees.some(a => "proposedNewTime" in a) || new Set(native.attendees.map(a => a.emailAddress.address.toLowerCase())).size !== native.attendees.length) fail();
  graphRsvpTime(native);
  microsoftRsvpDesiredState(microsoftEventState(native), own, response);
  return { id: native.id, etag: native["@odata.etag"], selfAddress: own, response, native };
}
export function microsoftRsvpProjection(evidence: MicrosoftRsvpEvidence) {
  const item = nativeSchema.parse(evidence.native);
  return { externalId: item.id, icalUid: item.iCalUId, etag: item["@odata.etag"], status: "active" as const, title: item.subject, description: item.body.content.trim() || null, location: item.location.displayName.trim() || null, organizer: item.organizer.emailAddress.address, url: null, recurrence: null, ...graphRsvpTime(item), providerState: microsoftEventState(item) };
}
/** Readback establishes the current response, never delivery of its notification. */
export function matchesMicrosoftRsvp(evidence: MicrosoftRsvpEvidence, actual: unknown) {
  try {
    const next = microsoftRsvpEvidence(actual, evidence.selfAddress, evidence.response);
    if (next.id !== evidence.id || !isDeepStrictEqual(microsoftEventState(next.native), microsoftRsvpDesiredState(microsoftEventState(evidence.native), evidence.selfAddress, evidence.response))) return false;
    const normalize = (input: Record<string, unknown>) => {
      const item = structuredClone(input) as any;
      for (const key of ["@odata.etag", "changeKey", "lastModifiedDateTime"]) delete item[key];
      item.responseStatus = { ...item.responseStatus, response: "response" }; delete item.responseStatus.time;
      for (const attendee of item.attendees) if (attendee.emailAddress.address.toLowerCase() === evidence.selfAddress) { attendee.status = { ...attendee.status, response: "response" }; delete attendee.status.time; }
      return item;
    };
    return isDeepStrictEqual(normalize(evidence.native), normalize(next.native));
  } catch { return false; }
}
export function microsoftRsvpHash(evidence: MicrosoftRsvpEvidence) {
  const canonical = (value: any): any => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)])) : value;
  return createHash("sha256").update(JSON.stringify(canonical(evidence))).digest("hex");
}

/** Exact UTC observation requested by transport, not a claim that the meeting's
 * authored timezone is UTC. All original provider timezone fields stay frozen. */
export function graphRsvpTime(input: unknown) {
  const endpoint = z.object({ dateTime: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?$/), timeZone: z.literal("UTC") });
  const item = z.object({ type: z.literal("singleInstance"), isAllDay: z.boolean(), isCancelled: z.literal(false), start: endpoint, end: endpoint }).parse(input);
  const parse = (value: string) => { if (/\.\d{3}\d*[1-9]/.test(value)) fail(); const date = new Date(`${value}Z`); if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 19) !== value.slice(0, 19)) fail(); return date; };
  const start = parse(item.start.dateTime), end = parse(item.end.dateTime);
  if (end < start) fail();
  if (item.isAllDay) {
    if (end <= start || ![start, end].every(value => value.toISOString().endsWith("T00:00:00.000Z"))) fail();
    return { start, end: new Date(end.getTime() - 86400000), isAllDay: true, timeModel: { kind: "all-day" as const } };
  }
  return resolveEventTimeEdit({ kind: "zoned", timeZone: "UTC", startLocal: start.toISOString().slice(0, -1), endLocal: end.toISOString().slice(0, -1) });
}
