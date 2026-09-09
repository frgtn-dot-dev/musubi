import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, user, events, externalEvents, externalCalendars, calendarEvents, eventOutbox, createCalendar, upsertExternalEvent, getEventSnapshot, providerStateVersion, prepareProviderReminderInstanceEdit, commitProviderReminderInstanceEdit, completeEventOutbox, hasProviderReminderInstanceSource, calendarMembers, getEventDeliveryResolutionContext, commitEventDeliveryResolution } from "@musubi/db";
import { googleReminderInstanceEvidence } from "./adapters/google_reminder_instance";
import { googleEventState } from "./adapters/provider_event_state";
import { googleAdapter } from "./adapters/google";
import { deliverEventOutbox } from "./event_delivery";
import type { EventTimeModel } from "@musubi/types";
async function main() {
  assert.equal(process.env.ENVIRONMENT, "test");
  const savedFetch = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error("Journal must not perform native I/O"); };
  try {
  for (const kind of ["zoned", "all-day"] as const) {
    for (const scenario of ["queue", "concurrent", "defaults", "off", "source", "parent-revision", "parent-mapping", "parent-deleted", "parent-unlinked", "child-identity", "mapping-identity", "parent-pending", "parent-cancelled", "tamper", "grant", "child-revision", "native-id"]) {
      const owner = `reminder-instance-${randomUUID()}`;
      await db.insert(user).values({ id: owner, name: owner, email: `${owner}@example.test`, isExternal: true });
      try {
        const calendar = await createCalendar({ creatorID: owner, name: "Instance fixture", color: "red" });
        const [link] = await db.insert(externalCalendars).values({ provider: "google", userID: owner, accountID: "fixture", calendarID: calendar.id, externalCalendarID: "guest@example.test" }).returning();
        const allDay = kind === "all-day";
        const originalStart = allDay ? { kind: "date" as const, value: "2026-10-25" } : { kind: "instant" as const, value: "2026-10-25T00:30:00.000Z" };
        const model: EventTimeModel = allDay ? { kind: "all-day" } : { kind: "zoned", timeZone: "Europe/Prague", startLocal: "2026-10-25T04:30:00.000", endLocal: "2026-10-25T05:30:00.000" };
        const native = { id: "instance", etag: '"child"', status: "confirmed", summary: "Moved meeting", start: allDay ? { date: "2026-10-26" } : { dateTime: "2026-10-25T04:30:00+01:00", timeZone: "Europe/Prague" }, end: allDay ? { date: "2026-10-27" } : { dateTime: "2026-10-25T05:30:00+01:00", timeZone: "Europe/Prague" }, recurringEventId: "series", originalStartTime: allDay ? { date: originalStart.value } : { dateTime: "2026-10-25T02:30:00+02:00", timeZone: "Europe/Prague" }, organizer: { email: "host@example.test" }, reminders: { useDefault: false, overrides: [{ method: "email", minutes: 30 }] }, extendedProperties: { private: { untouched: "private fixture" } }, attendees: [{ email: "guest@example.test", self: true, responseStatus: "needsAction" }, { email: "other@example.test", responseStatus: "accepted" }] };
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
        const request = { provider: "google", operationID: randomUUID(), expectedRevision: child.revision, expectedStateVersion: providerStateVersion(mapping), reminders: scenario === "defaults" ? { useDefault: true } : { useDefault: false, overrides: scenario === "off" ? [] : [{ method: "popup", minutes: 15 }] } };
        const candidate = await prepareProviderReminderInstanceEdit(owner, child.id, request);
        assert.equal(candidate.kind, "prepared"); if (candidate.kind !== "prepared") throw new Error("Expected context");
        const binding = candidate.context.instance!;
        assert.deepEqual(binding, { seriesID: parent.id, parentRevision: parent.revision, parentMappingID: parentMapping.id, externalSeriesID: "series", originalStart });
        const evidence = googleReminderInstanceEvidence(native, { eventID: mapping.externalEventID, etag: mapping.etag!, occurrence: { externalSeriesID: binding.externalSeriesID, originalStart: binding.originalStart } }, candidate.context.request.reminders);
        const commit = () => commitProviderReminderInstanceEdit(candidate.context, evidence.baseline, model);
        if (scenario === "parent-revision") await db.update(events).set({ revision: parent.revision + 1 }).where(eq(events.id, parent.id));
        if (scenario === "parent-mapping") await db.update(externalEvents).set({ externalEventID: "different" }).where(eq(externalEvents.id, parentMapping.id));
        if (scenario === "parent-deleted") await db.update(events).set({ deletedAt: new Date() }).where(eq(events.id, parent.id));
        if (scenario === "parent-unlinked") await db.delete(calendarEvents).where(and(eq(calendarEvents.eventID, parent.id), eq(calendarEvents.calendarID, calendar.id)));
        if (scenario === "child-identity") await db.update(events).set({ originalStart: allDay ? { kind: "date", value: "2026-10-26" } : { kind: "instant", value: "2026-10-26T01:30:00.000Z" } }).where(eq(events.id, child.id));
        if (scenario === "mapping-identity") await db.update(externalEvents).set({ externalSeriesID: "other" }).where(eq(externalEvents.id, mapping.id));
        if (scenario.startsWith("parent-") && ["parent-pending", "parent-cancelled"].includes(scenario)) await db.insert(eventOutbox).values({ id: randomUUID(), actorID: owner, mutationID: randomUUID(), position: 0, eventID: parent.id, revision: parent.revision, calendarID: calendar.id, externalCalendarLinkID: link!.id, provider: "google", userID: owner, accountID: "fixture", externalCalendarID: "guest@example.test", externalEventID: "series", action: "update", status: scenario === "parent-cancelled" ? "cancelled" : "pending", payload: { event: parent } });
        if (scenario === "grant") await db.update(calendarMembers).set({ role: "viewer" }).where(and(eq(calendarMembers.calendarID, calendar.id), eq(calendarMembers.userID, owner)));
        if (scenario === "child-revision") await db.update(events).set({ revision: child.revision + 1 }).where(eq(events.id, child.id));
        if (scenario === "native-id") evidence.baseline.id = "other";
        if (scenario === "tamper") candidate.context.instance!.parentRevision++;
        if (!["queue", "concurrent", "defaults", "off", "source"].includes(scenario)) {
          await assert.rejects(commit);
          assert.equal((await db.select().from(eventOutbox).where(eq(eventOutbox.eventID, child.id))).length, 0);
        } else {
          const receipts = scenario === "concurrent" ? await Promise.all([commit(), commit()]) : [await commit()];
          assert.equal(new Set(receipts.map(item => item.operationID)).size, 1);
          const rows = await db.select().from(eventOutbox).where(eq(eventOutbox.eventID, child.id));
          assert.equal(rows.length, 1); const row = rows[0]!;
          assert.deepEqual(row.payload.reminderInstance!.instance, binding);
          assert.deepEqual(row.payload.reminderInstance!.baseline, native);
          assert.deepEqual(row.payload.reminderInstance!.desiredState.reminders, { provider: "google", useDefault: candidate.context.request.reminders.useDefault, overrides: candidate.context.request.reminders.useDefault ? [] : candidate.context.request.reminders.overrides });
          const { reminders: _old, ...before } = state;
          const { reminders: _new, ...after } = row.payload.reminderInstance!.desiredState;
          assert.deepEqual(after, before, "Only personal reminders change in desired provider state");
          assert.deepEqual(await getEventSnapshot(child.id), child);
          assert.deepEqual(await getEventSnapshot(parent.id), parent);
          assert.deepEqual(await db.select().from(externalEvents).where(eq(externalEvents.calendarID, calendar.id)).orderBy(externalEvents.id), maps);
          assert.equal((await commit()).replayed, true);
          await assert.rejects(() => prepareProviderReminderInstanceEdit(owner, child.id, { ...request, operationID: randomUUID() }), "Another child intent blocks admission");
          await assert.rejects(() => prepareProviderReminderInstanceEdit(owner, child.id, { ...request, reminders: { useDefault: true }, expectedRevision: 999 }), "Operation key cannot be repurposed");
          const token = randomUUID(); await db.update(eventOutbox).set({ status: "attempting", leaseToken: token, leaseUntil: new Date(Date.now() + 60000) }).where(eq(eventOutbox.id, row.id));
          const [claimed] = await db.select().from(eventOutbox).where(eq(eventOutbox.id, row.id));
          assert.equal(await hasProviderReminderInstanceSource(claimed!), true);
          assert.equal(await completeEventOutbox(row.id, token, { externalEventId: "instance", etag: '"new"' }, { externalEventId: "instance", etag: native.etag }), undefined, "Generic ACK cannot accept a private instance journal");
          if (scenario === "source") {
            await db.update(events).set({ revision: parent.revision + 1 }).where(eq(events.id, parent.id));
            assert.equal(await hasProviderReminderInstanceSource(claimed!), false);
            await db.update(events).set({ revision: parent.revision }).where(eq(events.id, parent.id));
            await db.update(eventOutbox).set({ leaseUntil: new Date(0) }).where(eq(eventOutbox.id, row.id));
            assert.equal(await hasProviderReminderInstanceSource(claimed!), false);
          }
          await db.update(eventOutbox).set({ status: "pending", leaseToken: null, leaseUntil: null }).where(eq(eventOutbox.id, row.id));
          assert.notEqual((await deliverEventOutbox(row.id, () => googleAdapter))?.status, "completed", "Generic worker never dispatches private intent");
          await db.update(eventOutbox).set({ status: "conflict" }).where(eq(eventOutbox.id, row.id));
          const context = await getEventDeliveryResolutionContext(owner, child.id, row.id);
          await assert.rejects(() => commitEventDeliveryResolution(owner, { context, ref: { externalEventId: "instance", etag: native.etag }, remoteExists: true, action: "update", patch: {}, deletion: undefined }, { mutationId: randomUUID(), expectedLocalRevision: child.revision, expectedLatestOperationId: row.id, expectedRemoteExists: true, expectedRemoteEtag: native.etag }), "Generic content proof cannot replace a private instance journal");
          assert.deepEqual(await db.select().from(externalEvents).where(eq(externalEvents.calendarID, calendar.id)).orderBy(externalEvents.id), maps);
        }
      } finally { await db.delete(user).where(eq(user.id, owner)); }
    }
  }
  assert.equal(calls, 0);
  } finally { globalThis.fetch = savedFetch; }
  console.log("Google instance reminder journal: parent/slot CAS, private frozen intent, concurrent replay, authority/lease checks and generic-path isolation: OK");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
