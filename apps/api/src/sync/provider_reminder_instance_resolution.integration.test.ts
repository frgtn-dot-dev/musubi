import { prepareEventDeliveryResolution } from "./event_resolution";
import { commitEventDeliveryResolution, getEventDeliveryResolutionReplay } from "@musubi/db";
import { createServer } from "node:http";
import { config } from "@musubi/config";
import { googleAdapter } from "./adapters/google";
import { googleReminderInstanceTransport } from "./adapters/google_reminder_instance";
import { deliverEventOutbox } from "./event_delivery";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
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
    for (const scenario of ["deliver-resolve-resend", "deliver-resolve-recover", "legacy-defaults"]) {
      mode = "normal"; patches = 0; expectedPatchEtag = '"child"'; onRead = undefined; onPatch = undefined;
      config.api.providerReminderEditsEnabled = true;
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
        const initialRequest = { provider: "google", operationID: randomUUID(), expectedRevision: child.revision, expectedStateVersion: providerStateVersion(mapping), reminders: scenario === "deliver-defaults" ? { useDefault: true } : { useDefault: false, overrides: scenario === "deliver-off" ? [] : [{ method: "popup", minutes: 15 }] } };
        desired = initialRequest.reminders;
        const candidate = await prepareProviderReminderInstanceEdit(owner, child.id, initialRequest);
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
          if (scenario === "legacy-defaults") {
            const payload = structuredClone(row.payload);
            payload.reminderInstance!.request.reminders = { useDefault: true };
            payload.reminderInstance!.desiredState.reminders = { provider: "google", useDefault: true, overrides: [] };
            await db.update(eventOutbox).set({ payload, status: "conflict" }).where(eq(eventOutbox.id, row.id));
            const preview = await prepareEventDeliveryResolution(owner, child.id, row.id, () => adapter);
            assert.equal(preview.preview.canResolve, false);
            assert.equal(preview.preview.reason, "write-unsupported");
            assert.deepEqual(preview.preview.reminderResolution!.desired, { useDefault: true });
            assert.deepEqual(preview.preview.reminderResolution!.remote, state.reminders);
            assert.equal(patches, 0, "Historical defaults preview remains read-only");
            const request = { mutationId: randomUUID(), expectedLocalRevision: child.revision, expectedLatestOperationId: row.id, expectedRemoteExists: true, expectedRemoteEtag: remote.etag, expectedReminderStateVersion: preview.preview.reminderResolution!.stateVersion };
            await assert.rejects(() => commitEventDeliveryResolution(owner, preview.proof, request), (error: any) => error.code === "delivery-resolution-unavailable");
            const remaining = await db.select().from(eventOutbox).where(eq(eventOutbox.eventID, child.id));
            assert.equal(remaining.length, 1, "No replacement defaults intent");
            assert.equal(remaining[0]!.status, "conflict");
            assert.deepEqual(remaining[0]!.payload, payload, "Historical receipt is unchanged");
            assert.equal(patches, 0);
            continue;
          }
            const loseGrant = async () => { await db.update(calendarMembers).set({ role: "viewer" }).where(and(eq(calendarMembers.calendarID, calendar.id), eq(calendarMembers.userID, owner))); };
            const nativeIdentity = async () => { remote.originalStartTime = allDay ? { date: "2026-10-26" } : { dateTime: "2026-10-26T04:30:00+01:00", timeZone: "Europe/Prague" }; };
            onPatch = async () => {
              remote.attendees[1].responseStatus = "declined"; remote.etag = '"concurrent"';
              await upsertExternalEvent("google", owner, calendar.id, "guest@example.test", "instance", values, remote.etag, null, undefined, { timeModel: model, externalSeriesID: "series", originalStart }, undefined, googleEventState(remote));
            };
            const result = await deliverEventOutbox(row.id, () => adapter);
            assert.notEqual(result?.status, "completed");
            assert.equal(patches, 1);
              const beforePreview = patches;
              if (scenario === "deliver-resolve-resend") { remote.reminders = { useDefault: false, overrides: [{ method: "email", minutes: 60 }] }; remote.etag = '\"own-changed\"'; }
              // A newer accepted parent revision may be adopted only by an
              // explicit new preview, while parent and original slot stay fixed.
              await db.update(events).set({ revision: parent.revision + 1 }).where(eq(events.id, parent.id));
              const first = await prepareEventDeliveryResolution(owner, child.id, row.id, () => adapter);
              assert.equal(first.preview.canResolve, true);
              assert.equal(first.proof.reminder!.instance!.instance.parentRevision, parent.revision + 1);
              assert.deepEqual(first.preview.reminderResolution!.desired, desired);
              assert.equal(patches, beforePreview);
              const request = { mutationId: randomUUID(), expectedLocalRevision: child.revision, expectedLatestOperationId: row.id, expectedRemoteExists: true, expectedRemoteEtag: remote.etag, expectedReminderStateVersion: first.preview.reminderResolution!.stateVersion };
              await db.update(events).set({ revision: parent.revision + 2 }).where(eq(events.id, parent.id));
              await assert.rejects(() => commitEventDeliveryResolution(owner, first.proof, request));
              const second = await prepareEventDeliveryResolution(owner, child.id, row.id, () => adapter);
              assert.notEqual(second.preview.reminderResolution!.stateVersion, request.expectedReminderStateVersion, "Same native JSON with a changed parent invalidates the old preview");
              await assert.rejects(() => commitEventDeliveryResolution(owner, second.proof, request));
              remote.attendees[0].comment = "Current private comment";
              const fresh = await prepareEventDeliveryResolution(owner, child.id, row.id, () => adapter);
              assert.notEqual(fresh.preview.reminderResolution!.stateVersion, second.preview.reminderResolution!.stateVersion);
              assert.ok(!JSON.stringify(fresh.preview).includes("Current private comment"));
              const acceptedRequest = { ...request, expectedReminderStateVersion: fresh.preview.reminderResolution!.stateVersion };
              const savedOriginal = remote.originalStartTime; await nativeIdentity();
              await assert.rejects(() => prepareEventDeliveryResolution(owner, child.id, row.id, () => adapter));
              remote.originalStartTime = savedOriginal;
              await db.update(externalEvents).set({ externalEventID: "other-parent" }).where(eq(externalEvents.id, parentMapping.id));
              await db.update(externalEvents).set({ externalSeriesID: "other-parent" }).where(eq(externalEvents.id, mapping.id));
              remote.recurringEventId = "other-parent";
              await assert.rejects(() => prepareEventDeliveryResolution(owner, child.id, row.id, () => adapter));
              await db.update(externalEvents).set({ externalEventID: "series" }).where(eq(externalEvents.id, parentMapping.id));
              await db.update(externalEvents).set({ externalSeriesID: "series" }).where(eq(externalEvents.id, mapping.id));
              remote.recurringEventId = "series";
              await loseGrant(); await assert.rejects(() => commitEventDeliveryResolution(owner, fresh.proof, acceptedRequest));
              await db.update(calendarMembers).set({ role: "owner" }).where(and(eq(calendarMembers.calendarID, calendar.id), eq(calendarMembers.userID, owner)));
              await assert.rejects(() => commitEventDeliveryResolution(owner, { ...fresh.proof, reminder: { ...fresh.proof.reminder!, instance: undefined } }, acceptedRequest), "One-off reminder proof cannot replace this bound instance");
              const replacements = await Promise.all([commitEventDeliveryResolution(owner, fresh.proof, acceptedRequest), commitEventDeliveryResolution(owner, fresh.proof, acceptedRequest)]);
              assert.equal(new Set(replacements).size, 1);
              const replacement = replacements[0]!;
              assert.equal(await getEventDeliveryResolutionReplay(owner, child.id, row.id, acceptedRequest), replacement);
              await assert.rejects(() => getEventDeliveryResolutionReplay(owner, child.id, row.id, request));
              const [replacementRow] = await db.select().from(eventOutbox).where(eq(eventOutbox.id, replacement));
              assert.equal(replacementRow!.payload.reminderInstance!.instance.parentRevision, parent.revision + 2);
              assert.equal(replacementRow!.payload.reminderInstance!.request.operationID, acceptedRequest.mutationId);
              expectedPatchEtag = remote.etag;
              onPatch = undefined;
              const delivered = await deliverEventOutbox(replacement, () => adapter);
              assert.equal(delivered?.status, "completed", JSON.stringify({ scenario, status: delivered?.status, error: delivered?.errorCode, patches }));
              assert.equal(patches, beforePreview + (scenario === "deliver-resolve-resend" ? 1 : 0));
              assert.equal(remote.attendees[0].comment, "Current private comment");
              assert.equal(remote.attendees[1].responseStatus, "declined");
              assert.deepEqual(await getEventSnapshot(child.id), child);
      } finally {
        await db.delete(user).where(eq(user.id, owner)); }
    }
  }
  } finally { config.api.providerReminderEditsEnabled = savedFlag; globalThis.fetch = realFetch; await new Promise<void>(resolve => fixture.close(() => resolve())); }
  console.log("Google instance reminder explicit conflicts: bound family, concurrent replay, stale parent/identity refusal, conditional HTTP recovery, parent/permission/lease/pull fences: OK");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
