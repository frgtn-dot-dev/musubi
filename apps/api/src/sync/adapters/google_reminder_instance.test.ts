import assert from "node:assert/strict";
import { createServer } from "node:http";
import { config } from "@musubi/config";
import { EventWriteError, type GoogleReminderWrite } from "@musubi/types";
import { ProviderEventWriteError } from "../event_write";
import { googleReminderInstanceEvidence, confirmGoogleReminderInstance, googleReminderInstanceTransport } from "./google_reminder_instance";

const calendar = "owner@example.test", eventID = "instance/+ id", parent = "master/+ id";
const make = (day = false): any => ({ id: eventID, etag: '"old"', status: "confirmed", summary: "Original title", description: "Private notes", location: "Office", iCalUID: "series@example.test",
  organizer: { email: calendar, self: true }, attendees: [{ email: "guest@example.test", responseStatus: "accepted" }],
  recurringEventId: parent, originalStartTime: day ? { date: "2026-07-30" } : { dateTime: "2026-07-30T09:30:00+02:00", timeZone: "Europe/Prague" },
  start: day ? { date: "2026-07-30" } : { dateTime: "2026-07-30T11:30:00+02:00", timeZone: "Europe/Prague" },
  end: day ? { date: "2026-07-31" } : { dateTime: "2026-07-30T12:30:00+02:00", timeZone: "Europe/Prague" },
  reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 10 }] },
  extendedProperties: { private: { preserve: "yes" } }, hangoutLink: "https://meet.example.test/preserve",
});
const expected = (day = false) => ({ eventID, etag: '"old"', occurrence: { externalSeriesID: parent, originalStart: day ? { kind: "date" as const, value: "2026-07-30" } : { kind: "instant" as const, value: "2026-07-30T07:30:00.000Z" } } });
const desired: GoogleReminderWrite = { useDefault: false, overrides: [{ method: "popup", minutes: 5 }, { method: "email", minutes: 30 }] };

async function main() {
  for (const day of [false, true]) {
    for (const reminders of [desired, { useDefault: true }, { useDefault: false, overrides: [] }] as GoogleReminderWrite[]) {
      const input = make(day), proof = googleReminderInstanceEvidence(input, expected(day), reminders);
      input.summary = "Caller changed"; assert.equal(proof.baseline.summary, "Original title");
      const result = confirmGoogleReminderInstance({ ...proof.baseline, etag: '"new"', updated: "2026-07-01T00:00:00Z", reminders }, proof);
      assert.deepEqual(result.event.originalStart, expected(day).occurrence.originalStart);
      assert.equal(result.event.externalSeriesID, parent); assert.equal(result.event.timeModel?.kind, day ? "all-day" : "zoned");
      assert.deepEqual(result.state.attendees, confirmGoogleReminderInstance({ ...proof.baseline, reminders }, proof).state.attendees);
      assert.throws(() => confirmGoogleReminderInstance({ ...proof.baseline, reminders, location: "Changed elsewhere" }, proof), ProviderEventWriteError);
    }
  }
  for (const patch of [
    { id: "foreign" }, { recurringEventId: "foreign" }, { recurringEventId: eventID }, { recurrence: ["RRULE:FREQ=DAILY"] },
    { originalStartTime: { dateTime: "2026-07-31T09:30:00+02:00" } }, { originalStartTime: { dateTime: "2026-07-30T09:30:00" } },
    { originalStartTime: { dateTime: "2026-07-30T09:30:00.0001+02:00" } }, { originalStartTime: { date: "2026-07-30" } },
    { start: { dateTime: "2026-07-30T11:30:00+02:00" }, end: { dateTime: "2026-07-30T12:30:00+02:00" } },
    { end: { dateTime: "2026-07-30T12:30:00+02:00", timeZone: "Europe/Berlin" } }, { status: "cancelled" },
    { start: { dateTime: "2026-10-25T02:30:00+02:00", timeZone: "Europe/Prague" }, end: { dateTime: "2026-10-25T03:30:00+01:00", timeZone: "Europe/Prague" } },
    { start: { dateTime: "2026-10-25T02:30:00+01:00", timeZone: "Europe/Prague" }, end: { dateTime: "2026-10-25T03:30:00+01:00", timeZone: "Europe/Prague" } },
    { start: { dateTime: "2026-07-30T11:30:00.0001+02:00", timeZone: "Europe/Prague" } },
    { end: { dateTime: "2026-07-30T12:30:00.0001+02:00", timeZone: "Europe/Prague" } },
    { attendeesOmitted: true }, { locked: true }, { privateCopy: true }, { eventType: "birthday" },
    { reminders: { useDefault: false, overrides: [{ method: "sms", minutes: 5 }] } }, { etag: 'W/"weak"' },
  ]) assert.throws(() => googleReminderInstanceEvidence({ ...make(), ...patch }, expected(), desired));

  let current = make(), patches = 0, accepted = 0, calls = 0, primaryRole = "owner", primaryID = calendar;
  let readStatus = 200, afterWriteReadFailure = false, lostResponse = false, badSuccessBody = false, changedAfter = false, weakAfter = false;
  const fixture = createServer(async (req, res) => {
    calls++; assert.equal(req.headers.authorization, "Bearer fixture");
    const url = new URL(req.url!, "http://fixture"); res.setHeader("content-type", "application/json");
    const json = (body: unknown, status = 200) => { res.statusCode = status; res.end(JSON.stringify(body)); };
    if (url.pathname === "/calendar/v3/users/me/calendarList/primary") return json({ id: primaryID, primary: true, accessRole: primaryRole });
    assert.equal(url.pathname, `/calendar/v3/calendars/${encodeURIComponent(calendar)}/events/${encodeURIComponent(eventID)}`);
    if (req.method === "GET") return json(current, afterWriteReadFailure && accepted ? 503 : readStatus);
    assert.equal(req.method, "PATCH"); assert.equal(url.search, "?sendUpdates=none"); patches++;
    let raw = ""; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw); assert.deepEqual(Object.keys(body), ["reminders"]);
    if (req.headers["if-match"] !== current.etag) return json({ error: "changed" }, 412);
    accepted++; current = { ...current, reminders: body.reminders, etag: '"new"' };
    if (changedAfter) current.extendedProperties.private.preserve = "Concurrent foreign field";
    if (weakAfter) current.etag = 'W/"weak"';
    if (lostResponse) return json({ error: "lost acknowledgement" }, 503);
    if (badSuccessBody) { res.statusCode = 200; return res.end("{"); }
    json(current);
  });
  await new Promise<void>(resolve => fixture.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(fixture.address() as { port: number }).port}`, realFetch = globalThis.fetch;
  globalThis.fetch = (input, init) => { const url = new URL(String(input)); assert.equal(url.origin, "https://www.googleapis.com"); return realFetch(origin + url.pathname + url.search, init); };
  const flag = config.api.providerReminderEditsEnabled;
  const transport = googleReminderInstanceTransport(async () => "fixture");
  const reset = () => { current = make(); patches = 0; accepted = 0; calls = 0; primaryRole = "owner"; primaryID = calendar; readStatus = 200; afterWriteReadFailure = false; lostResponse = false; badSuccessBody = false; changedAfter = false; weakAfter = false; };
  const read = () => transport.read("user", "account", calendar, expected(), desired);
  try {
    config.api.providerReminderEditsEnabled = false; await assert.rejects(read(), EventWriteError); assert.equal(calls, 0);
    config.api.providerReminderEditsEnabled = true;
    for (const day of [false, true]) {
      reset(); current = make(day); const proof = await transport.read("user", "account", calendar, expected(day), desired);
      let checks = 0;
      const done = await transport.write("user", "account", calendar, proof, async () => { checks++; });
      assert.equal(done.recovered, false); assert.equal(checks, 1); assert.equal(patches, 1); assert.equal(accepted, 1);
      const recovered = await transport.write("user", "account", calendar, proof, async () => { throw new Error("Recovery must not write"); });
      assert.equal(recovered.recovered, true); assert.equal(patches, 1); assert.equal(current.summary, "Original title"); assert.equal(current.extendedProperties.private.preserve, "yes");
    }
    for (const day of [false, true]) {
      reset(); current = make(day);
      const proof = await transport.read("user", "account", calendar, expected(day), { useDefault: true });
      const frozen = structuredClone(proof);
      let checks = 0;
      const unsupportedDefaults = (error: unknown) => error instanceof EventWriteError && error.reason === "unsupported";
      // New defaults writes are unsupported even with the exact old baseline.
      await assert.rejects(transport.write("user", "account", calendar, proof, async () => { checks++; }), unsupportedDefaults);
      assert.equal(checks, 0); assert.equal(patches, 0); assert.equal(accepted, 0);
      // Historical normalization to a concrete popup is not inheritance, even
      // if its effective timing happens to match the current calendar defaults.
      for (const minutes of [10, 27]) {
        current = { ...make(day), etag: '\"normalized\"', reminders: { useDefault: false, overrides: [{ method: "popup", minutes }] } };
        assert.throws(() => confirmGoogleReminderInstance(current, proof),
          error => error instanceof ProviderEventWriteError && error.code === "provider-conflict" && error.outcome === "unconfirmed");
        await assert.rejects(transport.write("user", "account", calendar, proof, async () => { checks++; }), unsupportedDefaults);
        assert.equal(checks, 0); assert.equal(patches, 0); assert.equal(accepted, 0);
      }
      // A historical exact defaults result can still be confirmed read-only.
      current = { ...make(day), etag: '\"confirmed\"', reminders: { useDefault: true } };
      const recovered = await transport.write("user", "account", calendar, proof, async () => { checks++; });
      assert.equal(recovered.recovered, true);
      assert.equal(checks, 0); assert.equal(patches, 0); assert.equal(accepted, 0);
      assert.deepEqual(proof, frozen);
      // The supported explicit-off policy continues to use a conditional PATCH.
      reset(); current = make(day);
      const off = await transport.read("user", "account", calendar, expected(day), { useDefault: false, overrides: [] });
      assert.equal((await transport.write("user", "account", calendar, off, async () => {})).recovered, false);
      assert.deepEqual(current.reminders, { useDefault: false, overrides: [] });
      assert.equal(patches, 1); assert.equal(accepted, 1);
    }
    for (const fault of ["lost", "read", "body"] as const) {
      for (const code of ["provider-conflict", "provider-version-unavailable"] as const) {
      reset(); const proof = await read(); changedAfter = code === "provider-conflict"; weakAfter = code === "provider-version-unavailable";
      await assert.rejects(transport.write("user", "account", calendar, proof, async () => {}), error => error instanceof ProviderEventWriteError && error.outcome === "unconfirmed" && error.code === code);
      assert.equal(accepted, 1); assert.equal(patches, 1);
    }
    reset(); const proof = await read(); lostResponse = fault === "lost"; afterWriteReadFailure = fault === "read"; badSuccessBody = fault === "body";
      if (fault === "body") assert.equal((await transport.write("user", "account", calendar, proof, async () => {})).recovered, false);
      else await assert.rejects(transport.write("user", "account", calendar, proof, async () => {}), error => error instanceof ProviderEventWriteError && error.outcome === "unconfirmed");
      lostResponse = false; afterWriteReadFailure = false;
      assert.equal((await transport.write("user", "account", calendar, proof, async () => {})).recovered, true); assert.equal(patches, 1);
    }
    reset(); const proof = await read();
    await assert.rejects(transport.write("user", "account", calendar, proof, async () => { throw new Error("Local permission changed"); })); assert.equal(patches, 0);
    current.summary = "Concurrent native content"; await assert.rejects(transport.write("user", "account", calendar, proof, async () => {}), ProviderEventWriteError); assert.equal(patches, 0);
    reset(); const race = await read();
    await assert.rejects(transport.write("user", "account", calendar, race, async () => { current.etag = '"concurrent"'; }), ProviderEventWriteError); assert.equal(accepted, 0); assert.equal(patches, 1);
    for (const deny of ["role", "calendar", "partial", "missing"] as const) {
      reset(); if (deny === "role") primaryRole = "reader"; if (deny === "calendar") primaryID = "foreign@example.test"; if (deny === "partial") readStatus = 206; if (deny === "missing") readStatus = 404;
      await assert.rejects(read()); assert.equal(patches, 0);
    }
    reset(); const aborted = await read(), controller = new AbortController();
    await assert.rejects(transport.write("user", "account", calendar, aborted, async () => controller.abort(), controller.signal)); assert.equal(patches, 0);
    reset(); const frozen = await read();
    await transport.write("user", "account", calendar, frozen, async () => { frozen.reminders = { useDefault: true }; frozen.baseline.summary = "Mutated caller"; });
    assert.deepEqual(current.reminders, desired); assert.equal(current.summary, "Original title");
    console.log("Google instance reminder private proof/HTTP: bound original and known child time, minimal conditional PATCH, complete confirmation, one-write recovery, native/local denial, races and frozen intent: OK");
  } finally { config.api.providerReminderEditsEnabled = flag; globalThis.fetch = realFetch; fixture.closeAllConnections(); await new Promise<void>(resolve => fixture.close(() => resolve())); }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
