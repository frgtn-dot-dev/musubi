import assert from "node:assert/strict";
import { createServer } from "node:http";
import { EventSchema } from "@musubi/types";
import { resolveEventTimeEdit } from "@musubi/calendar";
import { graphSeriesCreateBody, graphSeriesCreateEvidence, findGraphCreatedSeries } from "./microsoft_series_create";

const saved = EventSchema.parse({ id: "00000000-0000-4000-8000-000000000181", revision: 1, creatorID: "owner", organizer: "", title: "Personal series", description: "Notes", location: "Office", color: "red", calendars: [], isCanceled: false, recurrence: "RRULE:FREQ=DAILY;COUNT=4", ...resolveEventTimeEdit({ kind: "zoned", timeZone: "Europe/Prague", startLocal: "2026-03-27T09:00:00", endLocal: "2026-03-27T10:00:00" }) });
const identity = { operationID: "00000000-0000-4000-8000-000000000ABC" };
const native: any = { id: "series/id", transactionId: identity.operationID.toLowerCase(), iCalUId: "native-uid", "@odata.etag": 'W/"opaque"', type: "seriesMaster", isAllDay: false, isCancelled: false, originalStartTimeZone: "Europe/Prague", originalEndTimeZone: "Europe/Prague", start: { dateTime: "2026-03-27T08:00:00.0000000", timeZone: "UTC" }, end: { dateTime: "2026-03-27T09:00:00.0000000", timeZone: "UTC" }, recurrence: { pattern: { type: "daily", interval: 1 }, range: { type: "numbered", startDate: "2026-03-27", numberOfOccurrences: 4, recurrenceTimeZone: "Europe/Prague" } }, subject: "Personal series", body: { contentType: "text", content: "Notes" }, location: { displayName: "Office" }, attendees: [], isOrganizer: true, organizer: { emailAddress: { address: "owner@example.test" } }, isDraft: false, isOnlineMeeting: false, onlineMeeting: null, onlineMeetingUrl: null, cancelledOccurrences: [], exceptionOccurrences: [], isReminderOn: true, reminderMinutesBeforeStart: 15, showAs: "busy", sensitivity: "normal", responseStatus: { response: "organizer" } };
const original = JSON.stringify(native);
const body = graphSeriesCreateBody(saved, identity);
assert.equal(body.transactionId, identity.operationID.toLowerCase());
assert.deepEqual(body.start, { dateTime: "2026-03-27T09:00:00.000", timeZone: "Europe/Prague" });
assert.deepEqual(body.attendees, []);
const proof = graphSeriesCreateEvidence(native, saved, identity, native.id);
assert.equal(proof.event.start.toISOString(), "2026-03-27T08:00:00.000Z");
assert.equal(proof.event.recurrence, "RRULE:FREQ=DAILY;INTERVAL=1;COUNT=4");
assert.equal(proof.ref.etag, 'W/"opaque"'); // metadata, not a strong/family CAS claim
assert.equal(proof.ref.icalUid, "native-uid");
assert.deepEqual(proof.event.providerState?.reminders, { provider: "microsoft", isOn: true, minutesBeforeStart: 15 });
assert.equal(JSON.stringify(native), original);
const weekly = { ...saved, recurrence: "RRULE:FREQ=WEEKLY;BYDAY=FR,MO;COUNT=4" };
const nativeWeekly = { ...native, recurrence: { ...native.recurrence, pattern: { type: "weekly", interval: 1, daysOfWeek: ["monday", "friday"], firstDayOfWeek: "monday" } } };
assert.equal(graphSeriesCreateEvidence(nativeWeekly, weekly, identity, native.id).event.recurrence, "RRULE:FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,FR;WKST=MO;COUNT=4");
assert.throws(() => graphSeriesCreateEvidence({ ...nativeWeekly, recurrence: { ...nativeWeekly.recurrence, pattern: { ...nativeWeekly.recurrence.pattern, daysOfWeek: ["tuesday", "friday"] } } }, weekly, identity, native.id));
assert.throws(() => graphSeriesCreateEvidence({ ...native, transactionId: null }, saved, identity, native.id));
for (const change of [
  { id: "different" }, { id: ".." }, { transactionId: identity.operationID }, { iCalUId: "" }, { "@removed": {} },
  { subject: "Changed" }, { body: { contentType: "html", content: "Notes" } }, { body: { contentType: "text", content: "Changed" } }, { location: { displayName: "Changed" } },
  { attendees: [{}] }, { attendees: undefined }, { isOrganizer: false }, { organizer: null }, { isDraft: true },
  { isOnlineMeeting: true }, { onlineMeeting: {} }, { onlineMeetingUrl: "https://meeting.test" },
  { cancelledOccurrences: ["opaque-cancelled-occurrence"] }, { cancelledOccurrences: undefined }, { exceptionOccurrences: [{}] }, { exceptionOccurrences: undefined },
  { "exceptionOccurrences@odata.nextLink": "https://graph.microsoft.com/next" }, { "exceptionOccurrences@odata.count": 1 }, { "@odata.nextLink": "https://graph.microsoft.com/next" },
  { start: { ...native.start, dateTime: "2026-03-27T08:15:00" } }, { originalEndTimeZone: "America/New_York" },
  { recurrence: { ...native.recurrence, range: { ...native.recurrence.range, numberOfOccurrences: 5 } } },
]) assert.throws(() => graphSeriesCreateEvidence({ ...native, ...change }, saved, identity, native.id));
for (const change of [{ recurrence: null }, { isCanceled: true }, { seriesID: saved.id }, { originalStart: { kind: "instant" as const, value: saved.start.toISOString() } }, { organizer: "host@example.test" }, { url: "https://meeting.test" }]) assert.throws(() => graphSeriesCreateBody({ ...saved, ...change }, identity));
const dates = { ...saved, ...resolveEventTimeEdit({ kind: "all-day", startDate: "2026-12-31", endDate: "2027-01-02" }) };
assert.equal(graphSeriesCreateBody(dates, identity).end.dateTime, "2027-01-03T00:00:00.000");
assert.equal(graphSeriesCreateEvidence({ ...native, isAllDay: true, originalStartTimeZone: "UTC", originalEndTimeZone: "UTC", start: { dateTime: "2026-12-31T00:00:00", timeZone: "UTC" }, end: { dateTime: "2027-01-03T00:00:00", timeZone: "UTC" }, recurrence: { ...native.recurrence, range: { type: "numbered", startDate: "2026-12-31", numberOfOccurrences: 4 } } }, dates, identity, native.id).event.end.toISOString(), "2027-01-02T00:00:00.000Z");

async function main() {
  let mode = "normal", reads: string[] = [];
  const calendar = "cal/one", path = "/v1.0/me/calendars/cal%2Fone/events";
  const next = `https://graph.microsoft.com${path}?$skiptoken=next`;
  const server = createServer((req, res) => {
    assert.equal(req.method, "GET"); assert.equal(req.headers.authorization, "Bearer synthetic-series-token");
    assert.match(String(req.headers.prefer), /outlook.timezone="UTC"/); assert.match(String(req.headers.prefer), /outlook.body-content-type="text"/);
    assert.equal(req.headers["cache-control"], "no-cache"); assert.equal(req.headers["if-match"], undefined);
    const url = new URL(req.url!, "http://fixture.test"); reads.push(url.pathname + url.search);
    const send = (value: unknown, status = 200) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(value)); };
    if (mode === "redirect") { res.writeHead(302, { location: "https://other.test/leak" }); res.end(); return; }
    if (mode === "partial") { res.setHeader("Content-Range", "bytes 0-100/500"); send({ value: [] }); return; }
    if (mode === "network") { req.socket.destroy(); return; }
    if (url.pathname === path) {
      if (url.searchParams.has("$skiptoken")) {
        if (mode === "page-failure") return send({}, 503);
        return send({ value: mode === "duplicate" ? [{ id: "duplicate", transactionId: native.transactionId }] : [] });
      }
      assert.equal(url.searchParams.get("$select"), "id,transactionId");
      if (mode === "empty") return send({ value: [] });
      if (mode === "malformed") return send({ value: [null] });
      const link = mode === "foreign" ? "https://other.test/leak" : mode === "wrong-calendar" ? next.replace("cal%2Fone", "other") : mode === "loop" ? `https://graph.microsoft.com${req.url}` : next;
      return send({ value: [{ id: "manual-event", transactionId: null }, { id: "ordinary-event" }, { id: native.id, transactionId: native.transactionId }], "@odata.nextLink": link });
    }
    assert.equal(url.pathname, `${path}/series%2Fid`);
    assert.equal(url.searchParams.get("$expand"), "exceptionOccurrences");
    const selected = url.searchParams.get("$select")!.split(",");
    for (const field of ["cancelledOccurrences", "exceptionOccurrences", "transactionId", "originalStartTimeZone", "isOrganizer", "attendees"]) assert.ok(selected.includes(field));
    if (mode === "missing") return send({}, 404);
    if (mode === "master-failure") return send({}, 503);
    if (mode === "changed") return send({ ...native, subject: "Changed after listing" });
    if (mode === "exception") return send({ ...native, exceptionOccurrences: [{ id: "new-exception" }] });
    return send(native);
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const realFetch = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const url = new URL(String(input)); assert.equal(url.origin, "https://graph.microsoft.com"); assert.equal(init?.redirect, "error");
    return realFetch(`http://127.0.0.1:${address.port}${url.pathname}${url.search}`, init);
  };
  const read = (event = saved, request = identity) => findGraphCreatedSeries("synthetic-series-token", calendar, event, request);
  try {
    assert.deepEqual(await read(), proof); assert.equal(reads.length, 3);
    mode = "empty"; reads = []; assert.equal(await read(), null); assert.equal(reads.length, 1);
    for (const scenario of ["duplicate", "foreign", "wrong-calendar", "loop", "page-failure", "malformed", "partial", "redirect", "network", "missing", "master-failure", "changed", "exception"]) {
      mode = scenario; reads = []; await assert.rejects(read); assert.ok(reads.length <= 3);
      if (["duplicate", "foreign", "wrong-calendar", "loop", "page-failure", "malformed", "partial", "redirect", "network"].includes(mode)) assert.ok(!reads.some(value => value.includes("series%2Fid")));
    }
    mode = "normal"; reads = [];
    const mutable = structuredClone(saved), request = { ...identity };
    const pending = read(mutable, request); mutable.title = "Changed local draft"; request.operationID = saved.id;
    assert.deepEqual(await pending, proof);
    const controller = new AbortController(); controller.abort();
    await assert.rejects(() => findGraphCreatedSeries("synthetic-series-token", calendar, saved, { ...identity, signal: controller.signal }));
    for (const invalid of [".", "..", "", " cal"]) await assert.rejects(() => findGraphCreatedSeries("synthetic-series-token", invalid, saved, identity));
    console.log("Graph recurring-create read evidence: exact personal master, time/rule/content, native identity, complete scoped pages, duplicate/partial/foreign refusal, fresh expanded master, cancellation/exception rejection and frozen inputs: OK");
  } finally { globalThis.fetch = realFetch; server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
