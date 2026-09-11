import { createServer } from "node:http";
import { config } from "@musubi/config";
import { googleAdapter } from "./adapters/google";
import { googleReminderInstanceTransport } from "./adapters/google_reminder_instance";
import { deliverEventOutbox } from "./event_delivery";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db, user, events, externalEvents, externalCalendars, eventOutbox, createCalendar, upsertExternalEvent, getEventSnapshot, providerStateVersion, prepareProviderReminderInstanceEdit, commitProviderReminderInstanceEdit, calendarMembers } from "@musubi/db";
import { googleReminderInstanceEvidence } from "./adapters/google_reminder_instance";
import { googleEventState } from "./adapters/provider_event_state";
import type { EventTimeModel } from "@musubi/types";

async function main() {
  assert.equal(process.env.ENVIRONMENT, "test");
  const savedFlag = config.api.providerReminderEditsEnabled;
  config.api.providerReminderEditsEnabled = true;
  let desired: any;
  let remote: any, mode = "normal", patches = 0, expectedPatchEtag = '"child"';
  let onRead: (() => Promise<void>) | undefined, onPatch: (() => Promise<void>) | undefined;
  const fixture = createServer(async (req, res) => {
    try {
      assert.equal(req.headers.authorization, "Bearer synthetic-instance-reminder");
      res.setHeader("content-type", "application/json");
      if (req.url === "/calendar/v3/users/me/calendarList/primary") { res.end(JSON.stringify({ id: "guest@example.test", primary: true, accessRole: "owner" })); return; }
      assert.ok(req.url?.startsWith("/calendar/v3/calendars/guest%40example.test/events/instance"));
      if (req.method === "GET") {
        if (onRead) { const action = onRead; onRead = undefined; await action(); }
        res.end(JSON.stringify(remote)); return;
      }
      assert.equal(req.method, "PATCH");
      assert.equal(req.url, "/calendar/v3/calendars/guest%40example.test/events/instance?sendUpdates=none");
      assert.equal(req.headers["if-match"], expectedPatchEtag);
      let body = ""; for await (const chunk of req) body += chunk;
      assert.deepEqual(JSON.parse(body), { reminders: desired });
      patches++;
      if (remote.etag !== req.headers["if-match"]) { res.writeHead(412); res.end(); return; }
      remote.reminders = desired.useDefault ? { useDefault: true, overrides: remote.reminders.overrides } : structuredClone(desired); remote.etag = '\"child-next\"';
      if (onPatch) { const action = onPatch; onPatch = undefined; await action(); }
      if (mode === "lost") { req.socket.destroy(); return; }
      if (mode === "503") { res.writeHead(503); res.end(); return; }
      res.end(JSON.stringify(remote));
    } catch (error) { res.statusCode = 500; res.end(JSON.stringify({ error: String(error) })); }
  });
  await new Promise<void>(resolve => fixture.listen(0, "127.0.0.1", resolve));
  const address = fixture.address(); assert.ok(address && typeof address !== "string");
  const realFetch = globalThis.fetch;
  globalThis.fetch = (input, init) => { const url = new URL(String(input)); assert.equal(url.origin, "https://www.googleapis.com"); return realFetch(`http://127.0.0.1:${address.port}${url.pathname}${url.search}`, init); };
  const adapter = { ...googleAdapter, reminderInstance: googleReminderInstanceTransport(async () => "synthetic-instance-reminder") };
  try {
  for (const kind of ["zoned", "all-day"] as const) {
    for (const scenario of ["deliver-ack-db", "deliver-concurrent", "deliver-baseline-pull", "deliver-flag-off", "deliver-native-unknown-after", "deliver-normal", "deliver-lost", "deliver-503", "deliver-defaults", "deliver-off", "deliver-parent-before", "deliver-parent-after", "deliver-parent-map-before", "deliver-parent-map-after", "deliver-child-before", "deliver-grant-before", "deliver-grant-after", "deliver-lease-after", "deliver-pull-echo", "deliver-pull-state", "deliver-native-original-before", "deliver-native-original-after"]) {
      mode = "normal"; patches = 0; expectedPatchEtag = '"child"'; onRead = undefined; onPatch = undefined;
      config.api.providerReminderEditsEnabled = true;
      let failureTrigger: string | undefined;
      const owner = `reminder-worker-${randomUUID()}`;
      await db.insert(user).values({ id: owner, name: owner, email: `${owner}@example.test`, isExternal: true });
      try {
        const calendar = await createCalendar({ creatorID: owner, name: "Instance fixture", color: "red" });
        await db.insert(externalCalendars).values({ provider: "google", userID: owner, accountID: "fixture", calendarID: calendar.id, externalCalendarID: "guest@example.test" }).returning();
        const allDay = kind === "all-day";
        const originalStart = allDay ? { kind: "date" as const, value: "2026-10-25" } : { kind: "instant" as const, value: "2026-10-25T00:30:00.000Z" };
        const model: EventTimeModel = allDay ? { kind: "all-day" } : { kind: "zoned", timeZone: "Europe/Prague", startLocal: "2026-10-25T04:30:00.000", endLocal: "2026-10-25T05:30:00.000" };
        const native = { id: "instance", etag: '"child"', status: "confirmed", summary: "Moved meeting", start: allDay ? { date: "2026-10-26" } : { dateTime: "2026-10-25T04:30:00+01:00", timeZone: "Europe/Prague" }, end: allDay ? { date: "2026-10-27" } : { dateTime: "2026-10-25T05:30:00+01:00", timeZone: "Europe/Prague" }, recurringEventId: "series", originalStartTime: allDay ? { date: originalStart.value } : { dateTime: "2026-10-25T02:30:00+02:00", timeZone: "Europe/Prague" }, organizer: { email: "host@example.test" }, reminders: { useDefault: false, overrides: [{ method: "email", minutes: 30 }] }, extendedProperties: { private: { untouched: "private fixture" } }, attendees: [{ email: "guest@example.test", self: true, responseStatus: "needsAction" }, { email: "other@example.test", responseStatus: "accepted" }] };
        remote = structuredClone(native);
        const state = googleEventState(native);
        const values = { title: native.summary, color: "red", start: new Date(allDay ? "2026-10-26T00:00:00Z" : "2026-10-25T03:30:00Z"), end: new Date(allDay ? "2026-10-26T00:00:00Z" : "2026-10-25T04:30:00Z"), isAllDay: allDay, description: null, location: null, organizer: "host@example.test", recurrence: null, url: null };
        const parentModel: EventTimeModel = allDay ? { kind: "all-day" } : { kind: "zoned", timeZone: "Europe/Prague", startLocal: "2026-10-24T02:30:00.000", endLocal: "2026-10-24T03:30:00.000" };
        await upsertExternalEvent("google", owner, calendar.id, "guest@example.test", "series", { ...values, title: "Series", start: new Date(allDay ? "2026-10-24T00:00:00Z" : "2026-10-24T00:30:00Z"), end: new Date(allDay ? "2026-10-24T00:00:00Z" : "2026-10-24T01:30:00Z"), recurrence: "RRULE:FREQ=DAILY;COUNT=4" }, '"parent"', null, undefined, { timeModel: parentModel }, undefined, state);
        await upsertExternalEvent("google", owner, calendar.id, "guest@example.test", "instance", values, native.etag, null, undefined, { timeModel: model, externalSeriesID: "series", originalStart }, undefined, state);
        const maps = await db.select().from(externalEvents).where(eq(externalEvents.calendarID, calendar.id)).orderBy(externalEvents.id);
        const mapping = maps.find(item => item.externalEventID === "instance")!;
        const parentMapping = maps.find(item => item.externalEventID === "series")!;
        const child = (await getEventSnapshot(mapping.eventID))!;
        const parent = (await getEventSnapshot(parentMapping.eventID))!;
        const request = { provider: "google", operationID: randomUUID(), expectedRevision: child.revision, expectedStateVersion: providerStateVersion(mapping), reminders: { useDefault: false, overrides: scenario === "deliver-off" ? [] : [{ method: "popup", minutes: 15 }] } };
        desired = request.reminders;
        const candidate = await prepareProviderReminderInstanceEdit(owner, child.id, request);
        assert.equal(candidate.kind, "prepared"); if (candidate.kind !== "prepared") throw new Error("Expected context");
        const binding = candidate.context.instance!;
        assert.deepEqual(binding, { seriesID: parent.id, parentRevision: parent.revision, parentMappingID: parentMapping.id, externalSeriesID: "series", originalStart });
        const evidence = googleReminderInstanceEvidence(native, { eventID: mapping.externalEventID, etag: mapping.etag!, occurrence: { externalSeriesID: binding.externalSeriesID, originalStart: binding.originalStart } }, candidate.context.request.reminders);
        const commit = () => commitProviderReminderInstanceEdit(candidate.context, evidence.baseline, model);
        await commit();
          const rows = await db.select().from(eventOutbox).where(eq(eventOutbox.eventID, child.id));
          assert.equal(rows.length, 1); const row = rows[0]!;
          assert.deepEqual(row.payload.reminderInstance!.instance, binding);
          assert.deepEqual(row.payload.reminderInstance!.baseline, native);
          assert.deepEqual(row.payload.reminderInstance!.request.reminders, desired);
          assert.deepEqual(await getEventSnapshot(child.id), child);
          assert.deepEqual(await getEventSnapshot(parent.id), parent);
          assert.deepEqual(await db.select().from(externalEvents).where(eq(externalEvents.calendarID, calendar.id)).orderBy(externalEvents.id), maps);
          assert.equal((await commit()).replayed, true);
          if (scenario === "deliver-defaults") {
            // Retained pending intent from before instance defaults were restricted.
            const payload = structuredClone(row.payload);
            payload.reminderInstance!.request.reminders = { useDefault: true };
            payload.reminderInstance!.desiredState.reminders = { provider: "google", useDefault: true, overrides: [] };
            await db.update(eventOutbox).set({ payload }).where(eq(eventOutbox.id, row.id));
          }
            const parentRevision = async () => { await db.update(events).set({ revision: parent.revision + 1 }).where(eq(events.id, parent.id)); };
            const parentIdentity = async () => { await db.update(externalEvents).set({ externalEventID: "other-parent" }).where(eq(externalEvents.id, parentMapping.id)); };
            const loseGrant = async () => { await db.update(calendarMembers).set({ role: "viewer" }).where(and(eq(calendarMembers.calendarID, calendar.id), eq(calendarMembers.userID, owner))); };
            const nativeIdentity = async () => { remote.originalStartTime = allDay ? { date: "2026-10-26" } : { dateTime: "2026-10-25T04:30:00+01:00", timeZone: "Europe/Prague" }; };
            if (scenario === "deliver-baseline-pull") onRead = async () => { await upsertExternalEvent("google", owner, calendar.id, "guest@example.test", "instance", values, remote.etag, null, undefined, { timeModel: model, externalSeriesID: "series", originalStart }, undefined, googleEventState(remote)); };
            if (scenario === "deliver-native-unknown-after") onPatch = async () => { remote.extendedProperties.private.untouched = "concurrent native content"; };
            if (scenario === "deliver-parent-before") onRead = parentRevision;
            if (scenario === "deliver-parent-after") onPatch = parentRevision;
            if (scenario === "deliver-parent-map-before") onRead = parentIdentity;
            if (scenario === "deliver-parent-map-after") onPatch = parentIdentity;
            if (scenario === "deliver-child-before") onRead = async () => { await db.update(events).set({ revision: child.revision + 1 }).where(eq(events.id, child.id)); };
            if (scenario === "deliver-grant-before") onRead = loseGrant;
            if (scenario === "deliver-grant-after") onPatch = loseGrant;
            if (scenario === "deliver-lease-after") onPatch = async () => { await db.update(eventOutbox).set({ leaseToken: randomUUID(), leaseUntil: new Date(Date.now() + 60000) }).where(eq(eventOutbox.id, row.id)); };
            if (scenario === "deliver-native-original-before") onRead = nativeIdentity;
            if (scenario === "deliver-native-original-after") onPatch = nativeIdentity;
            if (scenario.startsWith("deliver-pull-")) onPatch = async () => {
              if (scenario === "deliver-pull-state") { remote.attendees[1].responseStatus = "declined"; remote.etag = '\"concurrent\"'; }
              await upsertExternalEvent("google", owner, calendar.id, "guest@example.test", "instance", values, remote.etag, null, undefined, { timeModel: model, externalSeriesID: "series", originalStart }, undefined, googleEventState(remote));
            };
            if (scenario === "deliver-lost") mode = "lost";
            if (scenario === "deliver-503") mode = "503";
            if (scenario === "deliver-ack-db") {
              failureTrigger = `reminder_ack_fail_${randomUUID().replace(/-/g, "")}`;
              await db.execute(sql.raw(`CREATE FUNCTION ${failureTrigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic transient storage failure'; END $$`));
              await db.execute(sql.raw(`CREATE TRIGGER ${failureTrigger} BEFORE UPDATE ON external_events FOR EACH ROW WHEN (NEW.id = '${mapping.id}'::uuid) EXECUTE FUNCTION ${failureTrigger}()`));
            }
            if (scenario === "deliver-flag-off") config.api.providerReminderEditsEnabled = false;
            let result = scenario === "deliver-concurrent" ? (await Promise.all([deliverEventOutbox(row.id, () => adapter), deliverEventOutbox(row.id, () => adapter)])).find(value => value?.status === "completed") : await deliverEventOutbox(row.id, () => adapter);
            if (["deliver-lost", "deliver-503", "deliver-ack-db"].includes(scenario)) {
              assert.equal(result?.status, "unconfirmed", scenario); assert.equal(patches, 1);
              if (failureTrigger) { await db.execute(sql.raw(`DROP TRIGGER ${failureTrigger} ON external_events`)); await db.execute(sql.raw(`DROP FUNCTION ${failureTrigger}()`)); failureTrigger = undefined; }
              mode = "normal"; await db.update(eventOutbox).set({ nextAttemptAt: new Date(0) }).where(eq(eventOutbox.id, row.id));
              result = await deliverEventOutbox(row.id, () => adapter);
            }
            const completed = ["deliver-ack-db", "deliver-concurrent", "deliver-baseline-pull", "deliver-normal", "deliver-lost", "deliver-503", "deliver-pull-echo", "deliver-off"].includes(scenario);
            const [accepted] = await db.select().from(externalEvents).where(eq(externalEvents.id, mapping.id));
            if (completed) {
              assert.equal(result?.status, "completed", scenario);
              assert.equal(accepted!.etag, remote.etag); assert.deepEqual(accepted!.providerState, googleEventState(remote));
              assert.deepEqual(await getEventSnapshot(child.id), child);
              await upsertExternalEvent("google", owner, calendar.id, "guest@example.test", "instance", values, remote.etag, null, undefined, { timeModel: model, externalSeriesID: "series", originalStart }, undefined, googleEventState(remote));
              assert.deepEqual(await getEventSnapshot(child.id), child);
            } else {
              assert.notEqual(result?.status, "completed", scenario);
              assert.equal(accepted!.etag, native.etag, scenario);
              assert.equal(accepted!.providerState!.ownResponse, "needsAction", scenario);
            }
            if (scenario === "deliver-defaults") {
              assert.equal(result?.status, "blocked");
              assert.equal(result?.errorCode, "provider-write-unsupported");
            }
            assert.equal(patches, scenario.endsWith("-before") || ["deliver-flag-off", "deliver-defaults"].includes(scenario) ? 0 : 1, scenario);
      } finally {
        if (failureTrigger) { await db.execute(sql.raw(`DROP TRIGGER IF EXISTS ${failureTrigger} ON external_events`)); await db.execute(sql.raw(`DROP FUNCTION ${failureTrigger}()`)); }
        await db.delete(user).where(eq(user.id, owner)); }
    }
  }
  } finally { config.api.providerReminderEditsEnabled = savedFlag; globalThis.fetch = realFetch; await new Promise<void>(resolve => fixture.close(() => resolve())); }
  console.log("Private Google instance reminder delivery: bound family, concurrent replay, stale parent/identity refusal, conditional HTTP recovery, parent/permission/lease/pull fences: OK");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
