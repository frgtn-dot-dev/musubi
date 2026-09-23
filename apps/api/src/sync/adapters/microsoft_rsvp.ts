import { graphIdentitySchema, type GraphIdentity } from "./microsoft_identity";
import { isDeepStrictEqual } from "node:util";
import { createHash } from "node:crypto";
import { z } from "zod";
import { GraphRsvpOccurrenceSchema, type GraphRsvpOccurrence, type ProviderRsvpEdit, microsoftRsvpDesiredState, matchesMicrosoftRsvpObservedState } from "@musubi/types";
import { resolveEventTimeEdit } from "@musubi/calendar";
import { microsoftEventState } from "./provider_event_state";
import { ProviderEventWriteError } from "../event_write";

const address = z.object({ emailAddress: z.object({ address: z.email(), name: z.string().optional() }).passthrough() }).passthrough();
const responseStatus = z.object({ response: z.enum(["accepted", "tentativelyAccepted", "declined", "notResponded", "none"]), time: z.iso.datetime({ offset: true }).optional() }).passthrough();
const nativeCommon = z.object({
  id: z.string().min(1), iCalUId: z.string().min(1), "@odata.etag": z.string().min(1),
  changeKey: z.string().min(1).optional(), lastModifiedDateTime: z.iso.datetime({ offset: true }).optional(),
  isCancelled: z.literal(false), isOrganizer: z.literal(false), isDraft: z.literal(false),
  "@removed": z.never().optional(), "@odata.nextLink": z.never().optional(), "attendees@odata.nextLink": z.never().optional(),
  attendees: z.array(address.extend({ type: z.enum(["required", "optional", "resource"]), status: responseStatus })).min(1).max(200),
  organizer: address, responseStatus, subject: z.string(), body: z.object({ contentType: z.literal("text"), content: z.string() }),
  location: z.object({ displayName: z.string() }).passthrough(),
}).passthrough();
const nativeSchema = nativeCommon.extend({ type: z.literal("singleInstance"), recurrence: z.null(), seriesMasterId: z.null().optional(), originalStart: z.never().optional() });
const occurrenceSchema = nativeCommon.extend({ type: z.enum(["occurrence", "exception"]), recurrence: z.null(), seriesMasterId: z.string().min(1), originalStart: z.iso.datetime({ offset: true }) });
const masterSchema = nativeCommon.extend({ type: z.literal("seriesMaster"), recurrence: z.object({ pattern: z.record(z.string(), z.unknown()), range: z.record(z.string(), z.unknown()) }).passthrough(), seriesMasterId: z.null().optional(), originalStart: z.never().optional() });
export type MicrosoftRsvpEvidence = { graphIdentity?: GraphIdentity; occurrence?: GraphRsvpOccurrence; master?: Record<string, unknown>; id: string; etag: string; selfAddress: string; response: ProviderRsvpEdit["response"]; native: Record<string, unknown> };
const fail = (): never => { throw new ProviderEventWriteError("provider-conflict"); };
export function microsoftRsvpEvidence(input: unknown, selfAddress: string, response: ProviderRsvpEdit["response"], graphIdentity?: unknown, occurrence?: GraphRsvpOccurrence, masterInput?: unknown): MicrosoftRsvpEvidence {
  const native = (occurrence ? occurrenceSchema : nativeSchema).parse(structuredClone(input));
  const own = selfAddress.toLowerCase();
  const self = native.attendees.filter(a => a.emailAddress.address.toLowerCase() === own);
  if (self.length !== 1 || self[0]!.type === "resource" || native.organizer.emailAddress.address.toLowerCase() === own || native.attendees.some(a => "proposedNewTime" in a) || new Set(native.attendees.map(a => a.emailAddress.address.toLowerCase())).size !== native.attendees.length) fail();
  let master: Record<string, unknown> | undefined;
  if (occurrence) {
    occurrence = GraphRsvpOccurrenceSchema.parse(occurrence);
    const target = occurrenceSchema.parse(native);
    if (/\.\d{3}\d*[1-9]/.test(target.originalStart) || new Date(target.originalStart).toISOString() !== occurrence.originalStart.value || target.seriesMasterId !== occurrence.externalSeriesID || target.id === target.seriesMasterId) fail();
    const parent = masterSchema.parse(structuredClone(masterInput));
    if (parent.id !== occurrence.externalSeriesID || parent.organizer.emailAddress.address.toLowerCase() !== native.organizer.emailAddress.address.toLowerCase()) fail();
    // The attendee must belong to this mailbox in both the series and target.
    const self = parent.attendees.filter(a => a.emailAddress.address.toLowerCase() === own);
    if (self.length !== 1 || self[0]!.type === "resource" || parent.organizer.emailAddress.address.toLowerCase() === own || new Set(parent.attendees.map(a => a.emailAddress.address.toLowerCase())).size !== parent.attendees.length) fail();
    master = parent;
  } else if (masterInput !== undefined) fail();
  graphRsvpTime({ ...native, type: "singleInstance" });
  microsoftRsvpDesiredState(microsoftEventState(native), own, response);
  return { ...(graphIdentity ? { graphIdentity: graphIdentitySchema.parse(graphIdentity) } : {}), ...(occurrence ? { occurrence, master } : {}), id: native.id, etag: native["@odata.etag"], selfAddress: own, response, native };
}
export function microsoftRsvpProjection(evidence: MicrosoftRsvpEvidence) {
  const item = (evidence.occurrence ? occurrenceSchema : nativeSchema).parse(evidence.native);
  return { externalId: item.id, icalUid: item.iCalUId, etag: item["@odata.etag"], status: "active" as const, title: item.subject, description: item.body.content.trim() || null, location: item.location.displayName.trim() || null, organizer: item.organizer.emailAddress.address, url: null, recurrence: null, ...(evidence.occurrence ? evidence.occurrence : {}), ...graphRsvpTime({ ...item, type: "singleInstance" }), providerState: microsoftEventState(item) };
}
/** Readback establishes the current response, never delivery of its notification. */
export function matchesMicrosoftRsvp(evidence: MicrosoftRsvpEvidence, actual: unknown, master?: unknown) {
  try {
    const next = microsoftRsvpEvidence(actual, evidence.selfAddress, evidence.response, undefined, evidence.occurrence, master);
    if (evidence.occurrence && !matchesMicrosoftRsvpMaster(evidence.master, next.master)) return false;
    if (next.id !== evidence.id || !matchesMicrosoftRsvpObservedState(microsoftEventState(evidence.native), microsoftEventState(next.native), evidence.selfAddress, evidence.response)) return false;
    const normalize = (input: Record<string, unknown>) => {
      const item = structuredClone(input) as any;
      for (const key of ["@odata.etag", "changeKey", "lastModifiedDateTime"]) delete item[key];
      if (evidence.occurrence && evidence.native.type === "occurrence" && item.type === "exception") item.type = "occurrence";
      // The state check above authorizes only the evidenced availability transition.
      if (evidence.response === "accepted" && evidence.native.showAs === "tentative" && item.showAs === "busy") item.showAs = "tentative";
      if (evidence.response === "tentative" && evidence.native.showAs === "busy" && item.showAs === "tentative") item.showAs = "busy";
      item.responseStatus = { ...item.responseStatus, response: "response" }; delete item.responseStatus.time;
      for (const attendee of item.attendees) if (attendee.emailAddress.address.toLowerCase() === evidence.selfAddress) { attendee.status = { ...attendee.status, response: "response" }; delete attendee.status.time; }
      return item;
    };
    return isDeepStrictEqual(normalize(evidence.native), normalize(next.native));
  } catch { return false; }
}
/** An instance response may refresh the master version, but must not change
 * its response, guests, recurrence, content or any other authored field. */
export function matchesMicrosoftRsvpMaster(before: unknown, after: unknown) {
  try {
    const normalize = (value: unknown) => {
      const item = masterSchema.parse(structuredClone(value)) as Record<string, unknown>;
      for (const key of ["@odata.etag", "changeKey", "lastModifiedDateTime"]) delete item[key];
      return item;
    };
    return isDeepStrictEqual(normalize(before), normalize(after));
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
