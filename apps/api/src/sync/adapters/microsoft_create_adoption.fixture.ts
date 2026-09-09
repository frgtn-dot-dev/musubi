import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { Event } from "@musubi/types";
import { graphSeriesCreateBody } from "./microsoft_series_create";
import { graphSeriesFootprint } from "./microsoft_series_footprint";
export async function graphAdoptionFixture(event: Event) {
  const state = { event, operationID: "00000000-0000-4000-8000-000000000001", mode: "ok", reads: 0, writes: 0, lists: 0, hook: undefined as (() => Promise<void>) | undefined };
  const utc = (date: Date) => ({ dateTime: date.toISOString().replace(/Z$/, ""), timeZone: "UTC" });
  const master = () => ({ ...graphSeriesCreateBody(state.event, { operationID: state.operationID }), id: "master", iCalUId: "master-uid", "@odata.etag": 'W/"master"', type: "seriesMaster", start: utc(state.event.start), end: utc(state.event.end), isAllDay: state.event.isAllDay, isCancelled: false, originalStartTimeZone: state.event.timeModel?.kind === "zoned" ? state.event.timeModel.timeZone : "UTC", originalEndTimeZone: state.event.timeModel?.kind === "zoned" ? state.event.timeModel.timeZone : "UTC", organizer: { emailAddress: { address: "owner@example.test" } }, isOrganizer: true, isDraft: false, onlineMeeting: null, onlineMeetingUrl: null, cancelledOccurrences: [], exceptionOccurrences: [], isReminderOn: true, reminderMinutesBeforeStart: 15, showAs: "busy", sensitivity: "normal", responseStatus: { response: "organizer" } });
  const instances = () => graphSeriesFootprint(state.event).map((slot, index) => ({ ...master(), id: `child-${index}`, iCalUId: `uid-${index}`, "@odata.etag": `W/"child-${index}"`, type: "occurrence", seriesMasterId: "master", originalStart: slot.start.toISOString(), start: utc(slot.start), end: utc(slot.end), recurrence: null }));
  const server = createServer((req, res) => { void (async () => {
    if (req.method !== "GET") { state.writes++; throw new Error("Adoption must never write to Graph"); }
    state.reads++; assert.equal(req.headers.authorization, "Bearer fixture");
    const url = new URL(req.url!, "http://fixture"), json = (body: unknown, status = 200) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
    if (url.pathname === "/v1.0/me/calendars/calendar") return json({ id: "calendar", canEdit: state.mode !== "denied" });
    if (url.pathname === "/v1.0/me/calendars/calendar/events") { state.lists++; return json({ value: state.mode === "absent" ? [] : Array.from({ length: state.mode === "duplicate" ? 2 : 1 }, () => ({ id: "master", transactionId: state.operationID })) }); }
    if (url.pathname.endsWith("/events/master/instances")) {
      await state.hook?.(); const values = instances();
      if (state.mode === "partial") values.pop();
      if (state.mode === "child-meeting") values[0]!.attendees = [{ emailAddress: { address: "guest@example.test" }, type: "required", status: { response: "accepted" } }] as any;
      return json({ value: values });
    }
    if (url.pathname.endsWith("/events/master")) {
      const value: any = master();
      if (state.mode === "meeting") value.attendees = [{ emailAddress: { address: "guest@example.test" } }];
      if (state.mode === "no-end") value.recurrence.range = { type: "noEnd", startDate: value.recurrence.range.startDate, recurrenceTimeZone: value.recurrence.range.recurrenceTimeZone };
      if (state.mode === "exception") value.exceptionOccurrences = [{}];
      return json(value);
    }
    throw new Error(`Unexpected fixture route: ${url.pathname}`);
  })().catch(error => { res.statusCode = 500; res.end(JSON.stringify({ error: String(error) })); }); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (input, init) => { const url = new URL(String(input)); assert.equal(url.origin, "https://graph.microsoft.com"); return originalFetch(`http://127.0.0.1:${address.port}${url.pathname}${url.search}`, init); };
  return { state, originalFetch, close: async () => { globalThis.fetch = originalFetch; server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); } };
}
