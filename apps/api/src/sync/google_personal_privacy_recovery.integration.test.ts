import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { eq } from "drizzle-orm";
import { config } from "@musubi/config";
import { account, db, events, eventOutbox, externalEvents, getEventSnapshot, getOwnProviderEventObservation, getUserExternalCalendars, prepareProviderRsvpEdit, commitProviderRsvpEdit, prepareProviderReminderInstanceEdit, commitProviderReminderInstanceEdit, queueProviderReminderEdit, commitEventDeliveryResolution, user } from "@musubi/db";
import { googleAdapter } from "./adapters/google";
import { googleRsvpEventEvidence } from "./adapters/google_rsvp_projection";
import { googleReminderInstanceProjection } from "./adapters/google_reminder_instance";
import { syncProvider } from "./engine";
import { prepareEventDeliveryResolution } from "./event_resolution";
import { deliverEventOutbox } from "./event_delivery";

async function main() {
  assert.equal(process.env.ENVIRONMENT, "test");
  const flags = [config.api.eventTimeEditsEnabled, config.api.providerReminderEditsEnabled, config.api.providerRsvpEditsEnabled];
  config.api.eventTimeEditsEnabled = config.api.providerReminderEditsEnabled = config.api.providerRsvpEditsEnabled = true;
  let role = "owner", fail = false, patches = 0;
  let remote: any, parent: any;
  const fixture = createServer(async (req, res) => {
    try {
      assert.equal(req.headers.authorization, "Bearer privacy-fixture");
      const url = new URL(req.url!, "http://fixture.test");
      res.setHeader("content-type", "application/json");
      const json = (body: unknown) => res.end(JSON.stringify(body));
      const calendar = { id: "guest@example.test", summary: "Fixture", backgroundColor: "#7A8BA3", primary: true, accessRole: role };
      if (url.pathname === "/calendar/v3/users/me/calendarList") return json({ items: [calendar] });
      if (url.pathname.startsWith("/calendar/v3/users/me/calendarList/")) return json(calendar);
      if (url.pathname === "/tasks/v1/users/@me/lists") return json({ items: [] });
      if (req.method === "PATCH") {
        assert.equal(url.pathname, "/calendar/v3/calendars/guest%40example.test/events/subject");
        assert.equal(req.headers["if-match"], remote.etag);
        let bytes = ""; for await (const chunk of req) bytes += chunk;
        const body = JSON.parse(bytes);
        if (body.reminders) { assert.deepEqual(Object.keys(body), ["reminders"]); assert.equal(url.searchParams.get("sendUpdates"), "none"); remote.reminders = body.reminders; }
        else { assert.deepEqual(body, { attendeesOmitted: true, attendees: [{ email: "guest@example.test", responseStatus: "accepted" }] }); assert.equal(url.searchParams.get("sendUpdates"), "all"); remote.attendees[0].responseStatus = body.attendees[0].responseStatus; }
        patches++; remote.etag = '"written"'; return json(remote);
      }
      assert.equal(req.method, "GET");
      if (fail) { res.statusCode = 503; return json({ error: { message: "Unavailable" } }); }
      if (url.pathname.endsWith("/events")) return json({ items: parent ? [parent, remote] : [remote], nextSyncToken: "fresh" });
      if (url.pathname.endsWith("/subject")) return json(remote);
      if (url.pathname.endsWith("/series")) return json(parent);
      throw new Error("Unexpected fixture request");
    } catch (error) { res.statusCode = 500; res.end(JSON.stringify({ error: String(error) })); }
  });
  await new Promise<void>(resolve => fixture.listen(0, "127.0.0.1", resolve));
  const address = fixture.address(); assert.ok(address && typeof address !== "string");
  const realFetch = globalThis.fetch;
  globalThis.fetch = (input, init) => { const url = new URL(String(input)); assert.ok(["www.googleapis.com", "tasks.googleapis.com"].includes(url.hostname)); return realFetch(`http://127.0.0.1:${address.port}${url.pathname}${url.search}`, init); };
  try {
    for (const kind of ["zoned", "all-day"] as const) for (const instance of [false, true]) for (const setting of ["reminder", "rsvp"] as const) for (const race of (kind === "zoned" ? ["confirmed", "local", "mapping", "time", "intent", "multiple"] : ["confirmed", "local"])) {
      const owner = `privacy-personal-${randomUUID()}`;
      await db.insert(user).values({ id: owner, name: "Privacy", email: `${owner}@example.test` });
      try {
        role = "owner"; fail = false; patches = 0;
        const allDay = kind === "all-day";
        remote = { id: "subject", iCalUID: "fixture-uid", etag: '"initial"', status: "confirmed", summary: "Private before", visibility: "private", start: allDay ? { date: "2026-10-26" } : { dateTime: "2026-10-25T04:30:00+01:00", timeZone: "Europe/Prague" }, end: allDay ? { date: "2026-10-27" } : { dateTime: "2026-10-25T05:30:00+01:00", timeZone: "Europe/Prague" }, organizer: { email: "host@example.test" }, attendees: [{ email: "guest@example.test", self: true, responseStatus: "needsAction" }, { email: "other@example.test", responseStatus: "accepted", comment: "Preserve another attendee" }], reminders: { useDefault: false, overrides: [{ method: "email", minutes: 30 }] }, extendedProperties: { private: { fixture: "preserve" } } };
        parent = instance ? { ...structuredClone(remote), id: "series", etag: '"parent"', summary: "Private parent", start: allDay ? { date: "2026-10-24" } : { dateTime: "2026-10-24T02:30:00+02:00", timeZone: "Europe/Prague" }, end: allDay ? { date: "2026-10-25" } : { dateTime: "2026-10-24T03:30:00+02:00", timeZone: "Europe/Prague" }, recurrence: ["RRULE:FREQ=DAILY;COUNT=4"] } : undefined;
        if (instance) { remote.recurringEventId = "series"; remote.originalStartTime = allDay ? { date: "2026-10-25" } : { dateTime: "2026-10-25T02:30:00+02:00", timeZone: "Europe/Prague" }; }
        await db.insert(account).values({ id: randomUUID(), userId: owner, providerId: "google", accountId: "fixture", scope: "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/tasks", accessToken: "privacy-fixture", refreshToken: "privacy-refresh", accessTokenExpiresAt: new Date(Date.now() + 3600_000) });
        const sync = () => syncProvider(googleAdapter, owner, { id: "fixture", label: "Fixture" });
        await sync();
        const source = (await getUserExternalCalendars("google", owner, "fixture"))[0]!;
        const mappings = await db.select().from(externalEvents).where(eq(externalEvents.calendarID, source.calendarID));
        const mapping = mappings.find(value => value.externalEventID === "subject")!;
        const original = (await getEventSnapshot(mapping.eventID))!;
        const request = { provider: "google" as const, operationID: randomUUID(), expectedRevision: original.revision, expectedStateVersion: (await getOwnProviderEventObservation(owner, original.id)).version! };
        let operationID: string;
        if (setting === "rsvp") {
          const ready = await prepareProviderRsvpEdit(owner, original.id, { ...request, response: "accepted", sendUpdates: "all" });
          assert.equal(ready.kind, "prepared"); if (ready.kind !== "prepared") throw new Error("Expected preparation");
          const evidence = await googleAdapter.readRsvp!(owner, "fixture", "guest@example.test", { externalEventId: "subject", etag: remote.etag }, "accepted", undefined, ready.context.instance ? { externalSeriesID: ready.context.instance.externalSeriesID, originalStart: ready.context.instance.originalStart } : undefined);
          operationID = (await commitProviderRsvpEdit(ready.context, evidence.baseline, googleRsvpEventEvidence(evidence).timeModel!)).operationID;
        } else if (instance) {
          const reminders = { useDefault: false as const, overrides: [{ method: "popup" as const, minutes: 15 }] };
          const ready = await prepareProviderReminderInstanceEdit(owner, original.id, { ...request, reminders });
          assert.equal(ready.kind, "prepared"); if (ready.kind !== "prepared") throw new Error("Expected preparation");
          const evidence = await googleAdapter.reminderInstance!.readResolution(owner, "fixture", "guest@example.test", "subject", { externalSeriesID: ready.context.instance.externalSeriesID, originalStart: ready.context.instance.originalStart }, reminders);
          operationID = (await commitProviderReminderInstanceEdit(ready.context, evidence.baseline, googleReminderInstanceProjection(evidence).timeModel!)).operationID;
        } else operationID = (await queueProviderReminderEdit(owner, original.id, { ...request, reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 15 }] } })).operationID;
        const [saved] = await db.select().from(eventOutbox).where(eq(eventOutbox.id, operationID));
        role = "reader"; fail = true; await assert.rejects(sync(), /Google 503/);
        assert.equal((await getEventSnapshot(original.id))!.title, "Busy");
        role = "owner"; await assert.rejects(sync(), /Google 503/);
        remote.summary = "Fresh private content";
        fail = false; await sync();
        const restored = (await getEventSnapshot(original.id))!;
        assert.equal(restored.title, remote.summary);
        assert.ok(restored.revision > original.revision);
        const [retained] = await db.select().from(eventOutbox).where(eq(eventOutbox.id, operationID));
        assert.deepEqual(retained!.payload, saved!.payload);
        assert.equal(retained!.revision, saved!.revision);
        assert.equal(retained!.personalReadRecovery?.restoredRevision, restored.revision);
        assert.equal(patches, 0);
        const prepared = await prepareEventDeliveryResolution(owner, original.id, operationID, () => googleAdapter);
        assert.equal(prepared.preview.canResolve, true);
        const confirmation = { mutationId: randomUUID(), expectedLocalRevision: restored.revision, expectedLatestOperationId: operationID, expectedRemoteExists: true, expectedRemoteEtag: remote.etag, ...(setting === "rsvp" ? { expectedRsvpBaselineVersion: prepared.preview.rsvpResolution!.baselineVersion } : { expectedReminderStateVersion: prepared.preview.reminderResolution!.stateVersion }) };
        if (race !== "confirmed") {
          if (race === "local") await db.update(events).set({ title: restored.title, revision: restored.revision + 2 }).where(eq(events.id, original.id)); // an edit away and back cannot restore the old proof
          if (race === "mapping") await db.update(externalEvents).set({ id: randomUUID() }).where(eq(externalEvents.id, mapping.id));
          if (race === "time") { remote.start.dateTime = "2026-10-25T05:30:00+01:00"; remote.end.dateTime = "2026-10-25T06:30:00+01:00"; await sync(); }
          if (race === "intent") {
            const payload = structuredClone(retained!.payload);
            if (payload.rsvp) payload.rsvp.request.response = "declined";
            if (payload.reminderEdit) payload.reminderEdit.reminders = { useDefault: true };
            if (payload.reminderInstance) payload.reminderInstance.request.reminders = { useDefault: true };
            await db.update(eventOutbox).set({ payload }).where(eq(eventOutbox.id, operationID));
          }
          if (race === "multiple") await db.insert(eventOutbox).values({ ...retained!, id: randomUUID(), mutationID: randomUUID(), personalReadRecovery: null, status: "pending" });
          await assert.rejects(commitEventDeliveryResolution(owner, prepared.proof, confirmation));
          await assert.rejects(prepareEventDeliveryResolution(owner, original.id, operationID, () => googleAdapter));
          assert.equal(patches, 0);
        } else {
          const ids = await Promise.all([commitEventDeliveryResolution(owner, prepared.proof, confirmation), commitEventDeliveryResolution(owner, prepared.proof, confirmation)]);
          assert.equal(new Set(ids).size, 1);
          assert.equal((await deliverEventOutbox(ids[0]!, () => googleAdapter))?.status, "completed");
          assert.equal(patches, 1);
          assert.equal(remote.summary, "Fresh private content");
          assert.equal(remote.attendees[1].comment, "Preserve another attendee");
          assert.deepEqual(remote.extendedProperties.private, { fixture: "preserve" });
          const [replacement] = await db.select().from(eventOutbox).where(eq(eventOutbox.id, ids[0]!));
          assert.equal(replacement!.personalReadRecovery, null);
          assert.equal(replacement!.revision, restored.revision);
        }
        console.log(`Personal privacy recovery: ${setting}/${kind}/${instance ? "instance" : "one-off"}/${race}: OK`);
      } finally { await db.delete(user).where(eq(user.id, owner)); }
    }
  } finally {
    [config.api.eventTimeEditsEnabled, config.api.providerReminderEditsEnabled, config.api.providerRsvpEditsEnabled] = flags;
    globalThis.fetch = realFetch; await new Promise<void>(resolve => fixture.close(() => resolve()));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
