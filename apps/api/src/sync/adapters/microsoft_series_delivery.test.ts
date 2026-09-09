import assert from "node:assert/strict";
import { createServer } from "node:http";
import { config } from "@musubi/config";
import { EventSchema } from "@musubi/types";
import { resolveEventTimeEdit } from "@musubi/calendar";
import { ProviderEventWriteError } from "../event_write";
import { createGraphSeries } from "./microsoft_series_delivery";

const saved = EventSchema.parse({ id: "00000000-0000-4000-8000-000000000181", revision: 1, creatorID: "owner", organizer: "", title: "Personal series", description: "Notes", location: "Office", color: "red", calendars: [], isCanceled: false, recurrence: "RRULE:FREQ=DAILY;COUNT=4", ...resolveEventTimeEdit({ kind: "zoned", timeZone: "Europe/Prague", startLocal: "2026-03-27T09:00:00", endLocal: "2026-03-27T10:00:00" }) });
const identity = { operationID: "00000000-0000-4000-8000-000000000ABC" };
const native: any = { id: "series/id", transactionId: identity.operationID.toLowerCase(), iCalUId: "native-uid", "@odata.etag": 'W/"opaque"', type: "seriesMaster", isAllDay: false, isCancelled: false, originalStartTimeZone: "Europe/Prague", originalEndTimeZone: "Europe/Prague", start: { dateTime: "2026-03-27T08:00:00.0000000", timeZone: "UTC" }, end: { dateTime: "2026-03-27T09:00:00.0000000", timeZone: "UTC" }, recurrence: { pattern: { type: "daily", interval: 1 }, range: { type: "numbered", startDate: "2026-03-27", numberOfOccurrences: 4, recurrenceTimeZone: "Europe/Prague" } }, subject: "Personal series", body: { contentType: "text", content: "Notes" }, location: { displayName: "Office" }, attendees: [], isOrganizer: true, organizer: { emailAddress: { address: "owner@example.test" } }, isDraft: false, isOnlineMeeting: false, onlineMeeting: null, onlineMeetingUrl: null, cancelledOccurrences: [], exceptionOccurrences: [], isReminderOn: true, reminderMinutesBeforeStart: 15, showAs: "busy", sensitivity: "normal", responseStatus: { response: "organizer" } };

async function main() {
  let mode = "normal", remote: any = null, posts = 0, reads = 0, permissions = 0, attempts = 0, grant: unknown = true;
  const initialPayload = { subject: "Personal series", body: { contentType: "text", content: "Notes" }, location: { displayName: "Office" }, isAllDay: false, start: { dateTime: "2026-03-27T09:00:00.000", timeZone: "Europe/Prague" }, end: { dateTime: "2026-03-27T10:00:00.000", timeZone: "Europe/Prague" }, recurrence: { pattern: { type: "daily", interval: 1 }, range: { type: "numbered", startDate: "2026-03-27", recurrenceTimeZone: "Europe/Prague", numberOfOccurrences: 4 } }, transactionId: identity.operationID.toLowerCase(), attendees: [], isOnlineMeeting: false };
  let expectedPayload: any = structuredClone(initialPayload);
  let activeSaved = saved, activeNative = native;
  const calendar = "cal/one", base = "/v1.0/me/calendars/cal%2Fone";
  const server = createServer(async (req, res) => {
    assert.equal(req.headers.authorization, "Bearer synthetic-series-token");
    const url = new URL(req.url!, "http://fixture.test");
    const send = (value: unknown, status = 200) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(value)); };
    if (url.pathname === base) {
      permissions++; if (mode === "permission-failure") { res.setHeader("Retry-After", "2"); return send({}, 503); } assert.equal(req.method, "GET"); assert.equal(url.searchParams.get("$select"), "canEdit");
      return send({ canEdit: grant });
    }
    if (req.method === "GET") {
      reads++;
      if (mode === "initial-read-failure" || (posts && mode === "read-failure")) { res.setHeader("Retry-After", "2"); return send({}, 503); }
      if (url.pathname === `${base}/events`) return send({ value: remote ? [{ id: native.id, transactionId: native.transactionId }] : [] });
      assert.equal(url.pathname, `${base}/events/series%2Fid`); assert.ok(remote);
      return send(remote);
    }
    assert.equal(req.method, "POST"); assert.equal(url.pathname, `${base}/events`); assert.equal(url.search, "");
    assert.equal(req.headers["if-match"], undefined); assert.equal(req.headers["content-type"], "application/json");
    let body = ""; for await (const chunk of req) body += chunk;
    assert.deepEqual(JSON.parse(body), expectedPayload);
    assert.equal(attempts, 1); posts++;
    if (mode === "unapplied-503") return send({}, 503);
    if (mode === "denied") return send({}, 403);
    if (mode === "redirect") { res.writeHead(302, { location: "https://other.test/leak" }); res.end(); return; }
    remote = structuredClone(activeNative);
    if (mode === "changed") remote.subject = "Concurrent change";
    if (mode === "exception") remote.exceptionOccurrences = [{ id: "changed-child" }];
    if (mode === "lost") { req.socket.destroy(); return; }
    if (mode === "applied-503") return send({}, 503);
    if (mode === "partial") return send({}, 201);
    if (mode === "pending") return send({}, 202);
    return send({ id: mode === "wrong-response-id" ? "unrelated" : native.id }, 201);
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const realFetch = globalThis.fetch, oldFlag = config.api.eventTimeEditsEnabled;
  globalThis.fetch = (input, init) => {
    const url = new URL(String(input)); assert.equal(url.origin, "https://graph.microsoft.com"); assert.equal(init?.redirect, "error");
    return realFetch(`http://127.0.0.1:${address.port}${url.pathname}${url.search}`, init);
  };
  const write = (uncertain = false, beforeWrite = async () => { attempts++; }) => createGraphSeries("synthetic-series-token", calendar, activeSaved, identity, { uncertain, beforeWrite });
  const reset = () => { mode = "normal"; remote = null; posts = 0; reads = 0; permissions = 0; attempts = 0; grant = true; activeSaved = saved; activeNative = native; expectedPayload = structuredClone(initialPayload); };
  try {
    config.api.eventTimeEditsEnabled = false;
    await assert.rejects(write); assert.equal(reads + posts + permissions, 0);
    config.api.eventTimeEditsEnabled = true;
    for (const recurrence of ["FREQ=DAILY", "FREQ=DAILY;COUNT=367", "FREQ=DAILY;UNTIL=20290330T070000Z"]) {
      await assert.rejects(() => createGraphSeries("synthetic-series-token", calendar, { ...saved, recurrence }, identity, { uncertain: false, beforeWrite: async () => { attempts++; } }));
      assert.equal(posts + reads + permissions + attempts, 0);
    }
    for (const scenario of ["normal", "lost", "applied-503", "partial", "pending"]) {
      reset(); mode = scenario;
      const result = await write(); assert.equal(result.ref.externalEventId, native.id); assert.equal(result.recovered, scenario !== "normal");
      assert.equal(posts, 1); assert.equal(attempts, 1); assert.equal(permissions, 1);
      assert.equal((await write(true)).recovered, true); assert.equal(posts, 1); assert.equal(attempts, 1);
    }
    for (const scenario of ["unapplied-503", "read-failure", "changed", "exception", "wrong-response-id", "redirect"]) {
      reset(); mode = scenario;
      await assert.rejects(write, error => error instanceof ProviderEventWriteError && error.outcome === "unconfirmed");
      assert.equal(posts, 1); assert.equal(attempts, 1);
      if (scenario === "read-failure") { mode = "normal"; assert.equal((await write(true)).recovered, true); }
      else if (scenario !== "wrong-response-id") await assert.rejects(() => write(true));
      assert.equal(posts, 1);
    }
    reset();
    activeSaved = { ...saved, ...resolveEventTimeEdit({ kind: "all-day", startDate: "2026-12-31", endDate: "2027-01-02" }) };
    activeNative = { ...native, isAllDay: true, originalStartTimeZone: "UTC", originalEndTimeZone: "UTC", start: { dateTime: "2026-12-31T00:00:00", timeZone: "UTC" }, end: { dateTime: "2027-01-03T00:00:00", timeZone: "UTC" }, recurrence: { pattern: { type: "daily", interval: 1 }, range: { type: "numbered", startDate: "2026-12-31", numberOfOccurrences: 4 } } };
    expectedPayload = { ...initialPayload, isAllDay: true, start: { dateTime: "2026-12-31T00:00:00.000", timeZone: "UTC" }, end: { dateTime: "2027-01-03T00:00:00.000", timeZone: "UTC" }, recurrence: { pattern: { type: "daily", interval: 1 }, range: { type: "numbered", startDate: "2026-12-31", numberOfOccurrences: 4 } } };
    assert.equal((await write()).event.end.toISOString(), "2027-01-02T00:00:00.000Z"); assert.equal(posts, 1);
    for (const allDay of [false, true]) {
      for (const outcome of ["normal", "lost"]) {
        reset(); mode = outcome;
        activeSaved = { ...saved, recurrence: allDay ? "FREQ=DAILY;UNTIL=20270103" : "FREQ=DAILY;UNTIL=20260330T215959Z", ...(allDay ? resolveEventTimeEdit({ kind: "all-day", startDate: "2026-12-31", endDate: "2027-01-02" }) : {}) };
        const range = { type: "endDate", startDate: allDay ? "2026-12-31" : "2026-03-27", endDate: allDay ? "2027-01-03" : "2026-03-30", ...(allDay ? {} : { recurrenceTimeZone: "Europe/Prague" }) };
        activeNative = { ...native, ...(allDay ? { isAllDay: true, originalStartTimeZone: "UTC", originalEndTimeZone: "UTC", start: { dateTime: "2026-12-31T00:00:00", timeZone: "UTC" }, end: { dateTime: "2027-01-03T00:00:00", timeZone: "UTC" } } : {}), recurrence: { pattern: { type: "daily", interval: 1 }, range } };
        expectedPayload = { ...initialPayload, ...(allDay ? { isAllDay: true, start: { dateTime: "2026-12-31T00:00:00.000", timeZone: "UTC" }, end: { dateTime: "2027-01-03T00:00:00.000", timeZone: "UTC" } } : {}), recurrence: { pattern: { type: "daily", interval: 1 }, range } };
        const frozen = JSON.stringify(activeSaved);
        assert.equal((await write()).ref.externalEventId, native.id);
        assert.equal((await write(true)).recovered, true);
        assert.equal(posts, 1); assert.equal(attempts, 1); assert.equal(JSON.stringify(activeSaved), frozen);
        remote.recurrence.range.endDate = allDay ? "2027-01-04" : "2026-03-31";
        await assert.rejects(() => write(true), error => error instanceof ProviderEventWriteError && error.code === "provider-conflict");
        assert.equal(posts, 1);
      }
    }
    reset(); mode = "denied"; await assert.rejects(write, error => error instanceof ProviderEventWriteError && error.outcome === "not-written"); assert.equal(posts, 1);
    reset(); await assert.rejects(() => write(true)); assert.equal(posts + attempts, 0); assert.equal(permissions, 1);
    for (const value of [false, undefined, "true"]) { reset(); grant = value; await assert.rejects(write); assert.equal(posts + attempts, 0); }
    for (const scenario of ["initial-read-failure", "permission-failure", "changed-recovery", "permission-revoked"]) {
      reset(); mode = scenario;
      if (scenario === "changed-recovery") remote = { ...native, subject: "Concurrent" };
      if (scenario === "permission-revoked") grant = false;
      await assert.rejects(() => write(true), error => {
        assert.ok(error instanceof ProviderEventWriteError); assert.equal(error.outcome, "unconfirmed");
        if (scenario.endsWith("failure")) { assert.equal(error.providerStatus, 503); assert.equal(error.retryAfterMs, 2000); }
        if (scenario === "changed-recovery") assert.equal(error.code, "provider-conflict");
        return true;
      });
      assert.equal(posts + attempts, 0);
    }
    reset(); remote = structuredClone(native); grant = false; await assert.rejects(() => write(true)); assert.equal(posts + attempts, 0);
    reset(); await assert.rejects(() => write(false, async () => { throw new Error("lease lost"); }), /lease lost/); assert.equal(posts, 0);
    reset(); remote = { ...native, subject: "Unseen change" }; await assert.rejects(write); assert.equal(posts + attempts, 0);
    console.log("Private Graph recurring create delivery: disabled gate, one pre-write callback, exact POST, full native result proof, lost/partial/503 response recovery, never repeat uncertain missing create, permission/lease and native-change refusals: OK");
  } finally { config.api.eventTimeEditsEnabled = oldFlag; globalThis.fetch = realFetch; server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
