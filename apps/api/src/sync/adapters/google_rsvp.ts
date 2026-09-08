import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { EventWriteError } from "@musubi/types";
import { requireEventEtag, ProviderEventWriteError } from "../event_write";

export const GoogleRsvpResponseSchema = z.enum(["accepted", "tentative", "declined"]);
export type GoogleRsvpResponse = z.infer<typeof GoogleRsvpResponseSchema>;
const email = z.email();
const attendee = z.object({ email, self: z.boolean().optional(), organizer: z.boolean().optional(), resource: z.boolean().optional(), responseStatus: z.enum(["needsAction", "accepted", "tentative", "declined"]) }).passthrough();
const endpoint = z.union([
  z.object({ date: z.iso.date(), dateTime: z.never().optional() }).passthrough(),
  z.object({ dateTime: z.iso.datetime({ offset: true }), date: z.never().optional() }).passthrough(),
]);
const nativeEvent = z.object({
  id: z.string().min(1), etag: z.string(), status: z.enum(["confirmed", "tentative"]),
  organizer: z.object({ email, self: z.literal(false).optional() }).passthrough(),
  attendees: z.array(attendee).min(1).max(200), attendeesOmitted: z.literal(false).optional(),
  privateCopy: z.literal(false).optional(), locked: z.literal(false).optional(),
  eventType: z.literal("default").optional(),
  recurrence: z.never().optional(), recurringEventId: z.never().optional(), originalStartTime: z.never().optional(),
  start: endpoint, end: endpoint,
}).passthrough();
type NativeEvent = z.infer<typeof nativeEvent>;
export type GoogleRsvpEvidence = {
  /** Private native baseline: never expose it through the public event DTO. */
  baseline: NativeEvent;
  selfEmail: string;
  response: GoogleRsvpResponse;
  patch: { attendeesOmitted: true; attendees: [{ email: string; responseStatus: GoogleRsvpResponse }] };
};

/** Pure evidence only, not a grant or a live write. The caller must derive
 * authenticatedCopyEmail from the connected provider identity, never request JSON.
 * Calendar ownership and Musubi social attendance do not establish this identity. */
export function googleRsvpEvidence(input: unknown, expected: { eventId: string; etag: string; authenticatedCopyEmail: string }, response: GoogleRsvpResponse): GoogleRsvpEvidence {
  const parsed = nativeEvent.safeParse(input);
  if (!parsed.success || !email.safeParse(expected.authenticatedCopyEmail).success)
    throw new EventWriteError("event-write", "unsupported");
  const baseline = structuredClone(parsed.data);
  const startsAllDay = typeof baseline.start.date === "string";
  if (startsAllDay !== (typeof baseline.end.date === "string") ||
      Date.parse(String(baseline.end.date ?? baseline.end.dateTime)) <= Date.parse(String(baseline.start.date ?? baseline.start.dateTime)))
    throw new EventWriteError("event-write", "unsupported");
  if (baseline.id !== expected.eventId || requireEventEtag(baseline.etag) !== requireEventEtag(expected.etag))
    throw new ProviderEventWriteError("provider-conflict");
  const self = baseline.attendees.filter(item => item.self === true);
  const matches = baseline.attendees.filter(item => item.email.toLowerCase() === expected.authenticatedCopyEmail.toLowerCase());
  if (self.length !== 1 || matches.length !== 1 || self[0] !== matches[0] || self[0]!.organizer === true || self[0]!.resource === true || baseline.organizer.email.toLowerCase() === expected.authenticatedCopyEmail.toLowerCase())
    throw new EventWriteError("event-write", "unsupported");
  const desired = GoogleRsvpResponseSchema.parse(response);
  const selfEmail = self[0]!.email;
  return { baseline, selfEmail, response: desired, patch: { attendeesOmitted: true, attendees: [{ email: selfEmail, responseStatus: desired }] } };
}

/** Complete GET/response evidence after a future conditional write. This does
 * not establish exactly-once notification delivery. Truncation or any unrelated
 * native change fails closed; it must not advance an accepted baseline. */
export function confirmGoogleRsvp(input: unknown, evidence: GoogleRsvpEvidence): { etag: string } {
  const parsed = nativeEvent.safeParse(input);
  if (!parsed.success) throw new ProviderEventWriteError("provider-conflict", "unconfirmed");
  const current = parsed.data;
  const expected = structuredClone(evidence.baseline);
  const self = expected.attendees.find(item => item.self === true && item.email === evidence.selfEmail);
  if (!self) throw new ProviderEventWriteError("provider-conflict", "unconfirmed");
  self.responseStatus = evidence.response;
  const comparable = (value: NativeEvent) => {
    const { etag: _etag, updated: _updated, ...rest } = value;
    return rest;
  };
  if (!isDeepStrictEqual(comparable(current), comparable(expected)))
    throw new ProviderEventWriteError("provider-conflict", "unconfirmed");
  try { return { etag: requireEventEtag(current.etag) }; }
  catch { throw new ProviderEventWriteError("provider-version-unavailable", "unconfirmed"); }
}
