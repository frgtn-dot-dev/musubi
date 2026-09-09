import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, user, events, externalEvents, externalCalendars, calendarEvents, eventOutbox, createCalendar, upsertExternalEvent, getEventSnapshot, getOwnProviderEventObservation, prepareProviderRsvpEdit, prepareProviderRsvpInstanceEdit, commitProviderRsvpEdit, completeProviderRsvpOutbox, hasProviderRsvpSource } from "@musubi/db";
import { googleRsvpEvidence } from "./adapters/google_rsvp";
import { googleEventState } from "./adapters/provider_event_state";
import type { EventTimeModel } from "@musubi/types";

async function main() {
  assert.equal(process.env.ENVIRONMENT, "test");
  for (const kind of ["zoned", "all-day"] as const) {
    for (const scenario of ["queue", "concurrent", "parent-revision", "parent-mapping", "parent-deleted", "parent-unlinked", "child-identity", "mapping-identity", "parent-pending", "parent-cancelled", "tamper"]) {
      const owner = `rsvp-instance-${randomUUID()}`;
      await db.insert(user).values({ id: owner, name: owner, email: `${owner}@example.test`, isExternal: true });
      try {
        const calendar = await createCalendar({ creatorID: owner, name: "Instance fixture", color: "red" });
        const [link] = await db.insert(externalCalendars).values({ provider: "google", userID: owner, accountID: "fixture", calendarID: calendar.id, externalCalendarID: "guest@example.test" }).returning();
        const allDay = kind === "all-day";
        const originalStart = allDay ? { kind: "date" as const, value: "2026-10-25" } : { kind: "instant" as const, value: "2026-10-25T00:30:00.000Z" };
        const model: EventTimeModel = allDay ? { kind: "all-day" } : { kind: "zoned", timeZone: "Europe/Prague", startLocal: "2026-10-25T02:30:00.000", endLocal: "2026-10-25T03:30:00.000" };
        const native = { id: "instance", etag: '"child"', status: "confirmed", summary: "Moved meeting", start: allDay ? { date: "2026-10-26" } : { dateTime: "2026-10-25T02:30:00+01:00", timeZone: "Europe/Prague" }, end: allDay ? { date: "2026-10-27" } : { dateTime: "2026-10-25T03:30:00+01:00", timeZone: "Europe/Prague" }, recurringEventId: "series", originalStartTime: allDay ? { date: originalStart.value } : { dateTime: "2026-10-25T02:30:00+02:00", timeZone: "Europe/Prague" }, organizer: { email: "host@example.test" }, attendees: [{ email: "guest@example.test", self: true, responseStatus: "needsAction" }, { email: "other@example.test", responseStatus: "accepted" }] };
        const state = googleEventState(native);
        const values = { title: native.summary, color: "red", start: new Date(allDay ? "2026-10-26T00:00:00Z" : "2026-10-25T01:30:00Z"), end: new Date(allDay ? "2026-10-26T00:00:00Z" : "2026-10-25T02:30:00Z"), isAllDay: allDay, description: null, location: null, organizer: "host@example.test", recurrence: null, url: null };
        const parentModel: EventTimeModel = allDay ? { kind: "all-day" } : { kind: "zoned", timeZone: "Europe/Prague", startLocal: "2026-10-24T02:30:00.000", endLocal: "2026-10-24T03:30:00.000" };
        await upsertExternalEvent("google", owner, calendar.id, "guest@example.test", "series", { ...values, title: "Series", start: new Date(allDay ? "2026-10-24T00:00:00Z" : "2026-10-24T00:30:00Z"), end: new Date(allDay ? "2026-10-24T00:00:00Z" : "2026-10-24T01:30:00Z"), recurrence: "RRULE:FREQ=DAILY;COUNT=4" }, '"parent"', null, undefined, { timeModel: parentModel }, undefined, state);
        await upsertExternalEvent("google", owner, calendar.id, "guest@example.test", "instance", values, native.etag, null, undefined, { timeModel: model, externalSeriesID: "series", originalStart }, undefined, state);
        const maps = await db.select().from(externalEvents).where(eq(externalEvents.calendarID, calendar.id));
        const mapping = maps.find(item => item.externalEventID === "instance")!;
        const parentMapping = maps.find(item => item.externalEventID === "series")!;
        const child = (await getEventSnapshot(mapping.eventID))!;
        const parent = (await getEventSnapshot(parentMapping.eventID))!;
        const observation = await getOwnProviderEventObservation(owner, child.id, false, true);
        assert.equal(observation.rsvpEdit, undefined, "Public recurring capability remains closed during staged integration");
        const request = { provider: "google", operationID: randomUUID(), expectedRevision: child.revision, expectedStateVersion: observation.version, response: "accepted", sendUpdates: "all" };
        await assert.rejects(() => prepareProviderRsvpEdit(owner, child.id, request));
        const candidate = await prepareProviderRsvpInstanceEdit(owner, child.id, request);
        assert.equal(candidate.kind, "prepared"); if (candidate.kind !== "prepared") throw new Error("Expected context");
        const binding = candidate.context.instance!;
        assert.deepEqual(binding, { seriesID: parent.id, parentRevision: parent.revision, parentMappingID: parentMapping.id, externalSeriesID: "series", originalStart });
        const evidence = googleRsvpEvidence(native, { eventId: mapping.externalEventID, etag: mapping.etag!, authenticatedCopyEmail: "guest@example.test", occurrence: { externalSeriesID: binding.externalSeriesID, originalStart: binding.originalStart } }, "accepted");
        const commit = () => commitProviderRsvpEdit(candidate.context, evidence.baseline, model);
        if (scenario === "parent-revision") await db.update(events).set({ revision: parent.revision + 1 }).where(eq(events.id, parent.id));
        if (scenario === "parent-mapping") await db.update(externalEvents).set({ externalEventID: "different" }).where(eq(externalEvents.id, parentMapping.id));
        if (scenario === "parent-deleted") await db.update(events).set({ deletedAt: new Date() }).where(eq(events.id, parent.id));
        if (scenario === "parent-unlinked") await db.delete(calendarEvents).where(and(eq(calendarEvents.eventID, parent.id), eq(calendarEvents.calendarID, calendar.id)));
        if (scenario === "child-identity") await db.update(events).set({ originalStart: allDay ? { kind: "date", value: "2026-10-26" } : { kind: "instant", value: "2026-10-26T01:30:00.000Z" } }).where(eq(events.id, child.id));
        if (scenario === "mapping-identity") await db.update(externalEvents).set({ externalSeriesID: "other" }).where(eq(externalEvents.id, mapping.id));
        if (scenario.startsWith("parent-") && ["parent-pending", "parent-cancelled"].includes(scenario)) await db.insert(eventOutbox).values({ id: randomUUID(), actorID: owner, mutationID: randomUUID(), position: 0, eventID: parent.id, revision: parent.revision, calendarID: calendar.id, externalCalendarLinkID: link!.id, provider: "google", userID: owner, accountID: "fixture", externalCalendarID: "guest@example.test", externalEventID: "series", action: "update", status: scenario === "parent-cancelled" ? "cancelled" : "pending", payload: { event: parent } });
        if (scenario === "tamper") candidate.context.instance!.parentRevision++;
        if (!["queue", "concurrent"].includes(scenario)) {
          await assert.rejects(commit);
          assert.equal((await db.select().from(eventOutbox).where(eq(eventOutbox.eventID, child.id))).length, 0);
        } else {
          const receipts = scenario === "concurrent" ? await Promise.all([commit(), commit()]) : [await commit()];
          assert.equal(new Set(receipts.map(item => item.operationID)).size, 1);
          const rows = await db.select().from(eventOutbox).where(eq(eventOutbox.eventID, child.id));
          assert.equal(rows.length, 1); const row = rows[0]!;
          assert.deepEqual(row.payload.rsvp!.instance, binding);
          assert.deepEqual(row.payload.rsvp!.baseline, native);
          assert.equal(row.payload.rsvp!.desiredState.ownResponse, "accepted");
          assert.deepEqual(await getEventSnapshot(child.id), child);
          assert.deepEqual(await getEventSnapshot(parent.id), parent);
          assert.deepEqual(await db.select().from(externalEvents).where(eq(externalEvents.calendarID, calendar.id)), maps);
          assert.equal((await commit()).replayed, true);
          const token = randomUUID(); await db.update(eventOutbox).set({ status: "attempting", leaseToken: token, leaseUntil: new Date(Date.now() + 60000) }).where(eq(eventOutbox.id, row.id));
          const [claimed] = await db.select().from(eventOutbox).where(eq(eventOutbox.id, row.id));
          assert.equal(await hasProviderRsvpSource(claimed!), false, "Instance delivery remains explicitly closed in this journal slice");
          assert.equal(await completeProviderRsvpOutbox(row.id, token, { externalEventId: "instance", etag: '"new"' }, { externalEventId: "instance", etag: native.etag }, { isEcho: true, externalEventId: "instance", etag: '"new"', deleted: false, providerState: row.payload.rsvp!.desiredState, observedAt: new Date().toISOString() }), undefined);
        }
      } finally { await db.delete(user).where(eq(user.id, owner)); }
    }
  }
  console.log("Private Google instance RSVP journal: bound family, concurrent replay, stale parent/identity refusal, closed delivery: OK");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
