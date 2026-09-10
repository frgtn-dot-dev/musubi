import { createHash } from "node:crypto";
import ICAL from "ical.js";
import { CivilDateTimeSchema, EventWriteError, type ProviderEventState } from "@musubi/types";
import { requireEventEtag, ProviderEventWriteError } from "../event_write";
import { type CaldavSchedulingProof } from "../caldav_scheduling";
import { normalizeCaldavResource } from "./caldav_time";
import { caldavEventState } from "./provider_event_state";
import { replaceEventProperties } from "./caldav_event_ical";
import { canonicalCaldavResource } from "./caldav_series";

export type CaldavRsvpResponse = "accepted" | "tentative" | "declined";
export type CaldavRsvpMode = { mode?: "strict"; scheduleTag: string } | { mode: "icloud-oneoff-attendee"; scheduleTag: null };
export type CaldavRsvpEvidence = CaldavRsvpMode & {
  id: string; etag: string; uid: string;
  proof: CaldavSchedulingProof; selfAddress: string; response: CaldavRsvpResponse;
  before: string; after: string; desiredResourceHash: string;
};
function fail(): never { throw new ProviderEventWriteError("provider-conflict"); }
const address = (value: unknown): string => typeof value === "string" && /^mailto:[^\s<>@]+@[^\s<>@]+$/i.test(value) ? value.toLowerCase() : fail();
/** Parse a content-line header while preserving every unedited token. */
function header(line: string): { parts: string[]; tail: string } {
  const parts: string[] = []; let quote = false, start = 0;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') quote = !quote;
    if (!quote && (line[i] === ";" || line[i] === ":")) {
      parts.push(line.slice(start, i)); start = i + 1;
      if (line[i] === ":") {
        const names = parts.slice(1).map(part => part.slice(0, part.indexOf("=")).toLowerCase());
        if (names.some(name => !/^[a-z0-9-]+$/.test(name)) || new Set(names).size !== names.length) fail();
        ICAL.Property.fromString(line);
        return { parts, tail: line.slice(i) };
      }
    }
  }
  return fail();
}
/** Change one parameter on one top-level property, preserving other attendees,
 * nested components and all unrelated physical lines byte for byte. */
export function caldavRsvpParameter(data: string, name: string, ordinal: number, parameter: string, value?: string): string {
  replaceEventProperties(data, 0, new Map());
  const lines: { raw: string; text: string }[] = [];
  for (const raw of data.match(/[^\r\n]*(?:\r\n|\n|$)/g) ?? []) {
    if (!raw) continue;
    const text = raw.replace(/\r?\n$/, "");
    if (/^[ \t]/.test(text)) { const prior = lines[lines.length - 1]; if (!prior) fail(); prior.raw += raw; prior.text += text.slice(1); }
    else lines.push({ raw, text });
  }
  const stack: string[] = []; let seen = 0, changed = false;
  for (const line of lines) {
    const boundary = /^(BEGIN|END):([A-Z0-9-]+)$/i.exec(line.text);
    if (boundary) { if (boundary[1]!.toUpperCase() === "BEGIN") stack.push(boundary[2]!.toLowerCase()); else stack.pop(); continue; }
    if (stack.length !== 2 || stack[1] !== "vevent" || !line.text.toLowerCase().startsWith(name.toLowerCase() + ";") && !line.text.toLowerCase().startsWith(name.toLowerCase() + ":")) continue;
    const parsed = header(line.text);
    if (seen++ !== ordinal) continue;
    const parts = parsed.parts.filter((part, index) => index === 0 || part.slice(0, part.indexOf("=")).toLowerCase() !== parameter.toLowerCase());
    if (value !== undefined) parts.push(`${parameter.toUpperCase()}=${value}`);
    line.raw = parts.join(";") + parsed.tail + (line.raw.endsWith("\r\n") ? "\r\n" : line.raw.endsWith("\n") ? "\n" : ""); changed = true;
  }
  if (!changed) fail();
  return lines.map(line => line.raw).join("");
}
function timestamp(value: unknown): void {
  if (typeof value !== "string" || !/^\d{8}T\d{6}Z$/.test(value)) fail();
  CivilDateTimeSchema.parse(`${value.slice(0,4)}-${value.slice(4,6)}-${value.slice(6,8)}T${value.slice(9,11)}:${value.slice(11,13)}:${value.slice(13,15)}`);
}
/** Only RFC6638 server-owned reply metadata is ignored, after validation.
 * SEQUENCE, other attendee parameters and all private extensions stay exact. */
export function caldavRsvpResourceHash(data: string): string {
  const calendar = new ICAL.Component(ICAL.parse(data));
  const components = calendar.getAllSubcomponents("vevent"); if (components.length !== 1) fail();
  const event = components[0]!;
  const stamps = event.getAllProperties("dtstamp"); if (stamps.length > 1) fail();
  if (stamps.length) {
    const raw = data.replace(/\r?\n[ \t]/g, "").split(/\r?\n/).filter(line => /^DTSTAMP[:;]/i.test(line));
    // Reject parameterized or malformed timestamps before ICAL can normalize them.
    if (raw.length !== 1 || !/^DTSTAMP:\d{8}T\d{6}Z$/i.test(raw[0]!)) fail();
    timestamp(raw[0]!.slice(8));
  }
  const organizers = event.getAllProperties("organizer"); if (organizers.length !== 1) fail();
  const status = organizers[0]!.getParameter("schedule-status");
  if (status !== undefined && (typeof status !== "string" || !/^\d\.\d+(?:\.\d+)?(?:,\d\.\d+(?:\.\d+)?)*$/.test(status))) fail();
  const stripped = caldavRsvpParameter(replaceEventProperties(data, 0, new Map([["dtstamp", []]])), "organizer", 0, "schedule-status");
  return createHash("sha256").update(canonicalCaldavResource(stripped)).digest("hex");
}
export function prepareCaldavRsvp(data: string, ref: { id: string; etag: string; uid: string } & CaldavRsvpMode, proof: CaldavSchedulingProof, response: CaldavRsvpResponse): CaldavRsvpEvidence {
  requireEventEtag(ref.etag);
  if (ref.mode === "icloud-oneoff-attendee") {
    if (ref.scheduleTag !== null || proof.compatibility !== "icloud-oneoff-attendee" || proof.resourceWrite !== "empty-404" || proof.scheduleTag !== "empty-404") fail();
  } else {
    if (ref.mode !== undefined && ref.mode !== "strict" || proof.compatibility !== undefined) fail();
    requireEventEtag(ref.scheduleTag);
  }
  if (!["accepted", "tentative", "declined"].includes(response) || !ref.uid || proof.principal !== proof.owner || !proof.addresses.length || new Set(proof.addresses).size !== proof.addresses.length) fail();
  replaceEventProperties(data, 0, new Map());
  const calendar = new ICAL.Component(ICAL.parse(data)), components = calendar.getAllSubcomponents("vevent");
  if (calendar.name !== "vcalendar" || calendar.hasProperty("method") || components.length !== 1 || calendar.getAllSubcomponents().some(item => !["vevent", "vtimezone"].includes(item.name))) fail();
  const event = components[0]!;
  if (["rrule", "rdate", "exdate", "recurrence-id"].some(name => event.hasProperty(name)) || String(event.getFirstPropertyValue("status")).toUpperCase() === "CANCELLED") fail();
  for (const name of ["uid", "organizer", "dtstart", "dtend", "duration", "status", "dtstamp", "sequence"]) if (event.getAllProperties(name).length > 1) fail();
  if (event.getFirstPropertyValue("uid") !== ref.uid) fail();
  const organizer = event.getFirstProperty("organizer"); if (!organizer) fail();
  const organizerAddress = address(organizer.getFirstValue());
  if (proof.addresses.includes(organizerAddress) || organizer.getParameter("sent-by") || ![undefined, "SERVER"].includes(organizer.getParameter("schedule-agent")?.toString().toUpperCase())) fail();
  const attendees = event.getAllProperties("attendee"); if (!attendees.length || attendees.length > 200) fail();
  const addresses = attendees.map(item => address(item.getFirstValue()));
  if (new Set(addresses).size !== addresses.length) fail();
  for (const person of [organizer, ...attendees]) {
    if (["delegated-to", "delegated-from", "sent-by", "schedule-force-send"].some(name => person.getParameter(name) !== undefined)) fail();
    header(person.toICALString());
  }
  const self = addresses.flatMap((item, index) => proof.addresses.includes(item) ? [index] : []); if (self.length !== 1) fail();
  const status = attendees[self[0]!]!.getParameter("partstat")?.toString().toUpperCase() ?? "NEEDS-ACTION";
  if (!["NEEDS-ACTION", "ACCEPTED", "TENTATIVE", "DECLINED"].includes(status)) fail();
  const normalized = normalizeCaldavResource({ url: ref.id, etag: ref.etag, data });
  if (normalized.length !== 1 || !["zoned", "all-day"].includes(normalized[0]!.timeModel?.kind ?? "")) throw new EventWriteError("event-write", "unsupported");
  // No force-send: a repeated identical response is a resource no-op.
  const changed = caldavRsvpParameter(data, "attendee", self[0]!, "partstat", response.toUpperCase());
  const after = status === response.toUpperCase() ? data : changed;
  return { id: ref.id, etag: ref.etag, uid: ref.uid, ...(ref.mode === undefined ? { scheduleTag: ref.scheduleTag } : { mode: ref.mode, scheduleTag: ref.scheduleTag } as CaldavRsvpMode), proof: structuredClone(proof), selfAddress: addresses[self[0]!]!, response, before: data, after, desiredResourceHash: caldavRsvpResourceHash(after) };
}
export function caldavRsvpState(data: string): ProviderEventState {
  return caldavEventState(new ICAL.Component(ICAL.parse(data)).getFirstSubcomponent("vevent")!);
}
