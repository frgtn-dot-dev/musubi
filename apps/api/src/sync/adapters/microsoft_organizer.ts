import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { config } from "@musubi/config";
import { EventWriteError, MicrosoftOrganizerRequestSchema, OrganizerDispatchSchema, type MicrosoftOrganizerRequest, type ProviderOrganizerIntent } from "@musubi/types";
import { assertCompleteEventReadResponse } from "../event_create_identity";
import { ProviderEventWriteError } from "../event_write";
import { microsoftEventState } from "./provider_event_state";
import { verifiedGraphIdentity } from "./microsoft_identity";
const root = "https://graph.microsoft.com/v1.0";
const id = z.string().min(1).refine(value => value.trim() === value && value !== "." && value !== "..");
const fail = (): never => { throw new ProviderEventWriteError("provider-conflict"); };
export function microsoftOrganizerBody(request: MicrosoftOrganizerRequest, self: string) {
  request = MicrosoftOrganizerRequestSchema.parse(request);
  if (request.guests.some(guest => guest.email.toLowerCase() === self.toLowerCase())) fail();
  const time = request.time;
  if (time.kind === "floating") fail();
  return {
    transactionId: request.operationID,
    subject: request.content.title,
    body: { contentType: "text", content: request.content.description ?? "" },
    location: { displayName: request.content.location ?? "" },
    isAllDay: time.kind === "all-day",
    start: { dateTime: time.kind === "all-day" ? `${time.startDate}T00:00:00` : time.startLocal, timeZone: "UTC" },
    end: { dateTime: time.kind === "all-day" ? new Date(Date.parse(time.endDate + "T00:00:00Z") + 86_400_000).toISOString().slice(0, -1) : time.endLocal, timeZone: "UTC" },
    attendees: request.guests.map(guest => ({ emailAddress: { address: guest.email }, type: guest.optional ? "optional" : "required" })),
    isOnlineMeeting: false,
  };
}
const endpoint = z.object({ dateTime: z.string(), timeZone: z.literal("UTC") });
const nativeSchema = z.object({
  id, iCalUId: id, "@odata.etag": id, transactionId: z.uuid(), type: z.literal("singleInstance"),
  isCancelled: z.literal(false), isDraft: z.literal(false), isOrganizer: z.literal(true),
  recurrence: z.null(), seriesMasterId: z.null().optional(),
  subject: z.string(), body: z.object({ contentType: z.string(), content: z.string() }), location: z.object({ displayName: z.string() }),
  start: endpoint, end: endpoint, isAllDay: z.boolean(),
  originalStartTimeZone: z.literal("UTC"), originalEndTimeZone: z.literal("UTC"),
  "attendees@odata.count": z.number().int().nonnegative().optional(),
  organizer: z.object({ emailAddress: z.object({ address: z.email() }) }),
  attendees: z.array(z.object({ emailAddress: z.object({ address: z.email() }), type: z.enum(["required", "optional"]), status: z.object({ response: z.enum(["none", "notResponded", "accepted", "tentativelyAccepted", "declined"]), time: z.iso.datetime().optional() }).optional() })).min(1).max(100),
  isOnlineMeeting: z.literal(false), onlineMeeting: z.null(), onlineMeetingUrl: z.null(), hasAttachments: z.literal(false),
  "@removed": z.never().optional(), "attendees@odata.nextLink": z.never().optional(),
});
function instant(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?$/.test(value) || /[1-9]/.test((value.split(".")[1] ?? "").slice(3))) fail();
  const timestamp = Date.parse(value + "Z"); if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 19) !== value.slice(0, 19)) fail(); return timestamp;
}
export function microsoftOrganizerEvidence(raw: unknown, request: MicrosoftOrganizerRequest, self: string) {
  const native = nativeSchema.parse(raw), desired = microsoftOrganizerBody(request, self);
  const guests = (values: { emailAddress: { address: string }; type: string }[]) => values.map(value => `${value.emailAddress.address.toLowerCase()}:${value.type}`).sort();
  if (native.transactionId !== desired.transactionId || native.organizer.emailAddress.address.toLowerCase() !== self.toLowerCase()
    || native.subject !== desired.subject || native.body.contentType.toLowerCase() !== "text" || native.body.content !== desired.body.content
    || native.location.displayName !== desired.location.displayName || native.isAllDay !== desired.isAllDay
    || instant(native.start.dateTime) !== instant(desired.start.dateTime) || instant(native.end.dateTime) !== instant(desired.end.dateTime)
    || (native["attendees@odata.count"] !== undefined && native["attendees@odata.count"] !== native.attendees.length)
    || !isDeepStrictEqual(guests(native.attendees), guests(desired.attendees))) fail();
  return { native: { id: native.id, etag: native["@odata.etag"], iCalUID: native.iCalUId }, state: microsoftEventState(raw as Record<string, unknown>) };
}
export function microsoftOrganizerTransport(token: (user: string, account: string) => Promise<string>) {
  return async (userID: string, accountID: string, calendarID: string, signal?: AbortSignal) => {
    if (!config.api.providerOrganizerEditsEnabled) throw new EventWriteError("organizer", "unsupported");
    id.parse(accountID); id.parse(calendarID);
    const headers = { Authorization: `Bearer ${await token(userID, accountID)}`, Prefer: 'outlook.timezone="UTC", outlook.body-content-type="text"', "Cache-Control": "no-cache" };
    const get = async (url: string) => { const response = await fetch(url, { headers, redirect: "error", signal }); assertCompleteEventReadResponse(response); return response.json(); };
    const identity = await verifiedGraphIdentity(get, accountID, calendarID);
    const email = identity.selfAddress;
    const base = `${root}/me/calendars/${encodeURIComponent(calendarID)}/events`;
    async function find(request: MicrosoftOrganizerRequest) {
      let next: string | undefined = `${base}?$top=100`;
      const visited = new Set<string>(); let found: unknown;
      while (next) {
        const url = new URL(next);
        if (url.origin !== new URL(base).origin || url.pathname !== new URL(base).pathname || url.username || url.password || url.hash || visited.has(url.href) || visited.size >= 1000) fail();
        visited.add(url.href);
        const page = z.object({ value: z.array(z.record(z.string(), z.unknown())), "@odata.nextLink": z.string().min(1).refine(value => value.trim() === value).optional() }).parse(await get(url.href));
        for (const item of page.value) if (item.transactionId === request.operationID) { if (found) fail(); found = item; }
        next = page["@odata.nextLink"];
      }
      return found ? microsoftOrganizerEvidence(found, request, email) : null;
    }
    return { email, identity, deliver: async (intent: ProviderOrganizerIntent, beforeDispatch: () => Promise<void>, accepted: () => Promise<void>) => {
      const saved = structuredClone(intent), request = MicrosoftOrganizerRequestSchema.parse(saved.request);
      if (!isDeepStrictEqual(saved.graphIdentity, identity) || saved.baseline || saved.mappingID || !isDeepStrictEqual(saved.desired, microsoftOrganizerBody(request, email))) fail();
      if (saved.dispatch && OrganizerDispatchSchema.parse(saved.dispatch).kind !== "microsoft-organizer-dispatch") fail();
      if (saved.dispatch) { const observed = await find(request); return observed ? { kind: "observed" as const, ...observed } : { kind: "unconfirmed" as const }; }
      const existing = await find(request);
      if (existing) return { kind: "observed" as const, ...existing };
      // Persist possible dispatch before POST. No later attempt may send again.
      await beforeDispatch();
      let returnedID: string | undefined;
      try {
        const response = await fetch(base, { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify(saved.desired), redirect: "error", signal });
        if (response.status === 201) { returnedID = id.parse((await response.json()).id); await accepted(); }
      } catch (error) { if (signal?.aborted) throw error; }
      const observed = await find(request);
      if (observed && returnedID && observed.native.id !== returnedID) fail();
      return observed ? { kind: "observed" as const, ...observed } : { kind: "unconfirmed" as const };
    } };
  };
}
