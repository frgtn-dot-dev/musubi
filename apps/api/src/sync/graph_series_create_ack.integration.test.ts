import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { config } from "@musubi/config";
import { EventSchema } from "@musubi/types";
import { expandRecurringEvents, resolveEventTimeEdit } from "@musubi/calendar";
import { account, db, events, externalEvents, externalCalendars, externalEventTombstones, eventOutbox, user, importExternalCalendar, queueGraphSeriesCreate, claimEventOutbox, completeGraphSeriesCreateOutbox, readGraphFamilyContext, replaceGraphFamily, upsertExternalEvent, type GraphFamilyObservation } from "@musubi/db";
import { microsoftEventState } from "./adapters/provider_event_state";

async function run(allDay: boolean) {
  assert.equal(process.env.ENVIRONMENT, "test");
  const actor = `graph-create-ack-${randomUUID()}`, flag = config.api.eventTimeEditsEnabled;
  await db.insert(user).values({ id: actor, name: "Fixture", email: `${actor}@example.test` });
  try {
    config.api.eventTimeEditsEnabled = true;
    await db.insert(account).values({ id: randomUUID(), userId: actor, providerId: "microsoft", accountId: "fixture", scope: "Calendars.ReadWrite", refreshToken: "fixture" });
    const calendar = await importExternalCalendar("microsoft", actor, "fixture", "Fixture", { externalId: "calendar", name: "Fixture", color: "red" });
    const [link] = await db.select().from(externalCalendars).where(eq(externalCalendars.calendarID, calendar.id));
    const event = EventSchema.parse({ id: randomUUID(), revision: 1, creatorID: actor, organizer: actor, title: "Series", color: "red", calendars: [calendar.id], originCalendarID: calendar.id, isCanceled: false, description: "Notes", location: "Office", recurrence: "RRULE:FREQ=DAILY;COUNT=4", ...resolveEventTimeEdit(allDay ? { kind: "all-day", startDate: "2026-12-30", endDate: "2026-12-31" } : { kind: "zoned", timeZone: "Europe/Prague", startLocal: "2026-03-27T09:00:00", endLocal: "2026-03-27T10:00:00" }) });
    const queued = await queueGraphSeriesCreate(actor, randomUUID(), event), claimed = (await claimEventOutbox(queued.operationID))!, token = claimed.leaseToken!;
    const state = microsoftEventState({ type: "seriesMaster", isCancelled: false, isOrganizer: true, organizer: { emailAddress: { address: "owner@example.test" } }, attendees: [], isReminderOn: true, reminderMinutesBeforeStart: 15, showAs: "busy", sensitivity: "normal", responseStatus: { response: "organizer" } });
    const values = { title: event.title, description: event.description ?? null, location: event.location ?? null, url: null, organizer: "owner@example.test", start: event.start, end: event.end, isAllDay: event.isAllDay, timeModel: event.timeModel!, recurrence: event.recurrence ?? null };
    const proof: GraphFamilyObservation = { master: { creationOperationID: queued.operationID, externalID: "master", icalUid: "master-uid", etag: 'W/"master"', values, providerState: state }, cancelled: [], instances: [27, 28, 29, 30].map(day => {
      const time = allDay ? { start: new Date(event.start.getTime() + (day - 27) * 86400000), end: new Date(event.end.getTime() + (day - 27) * 86400000), isAllDay: true, timeModel: { kind: "all-day" as const } } : resolveEventTimeEdit({ kind: "zoned", timeZone: "Europe/Prague", startLocal: `2026-03-${day}T09:00:00`, endLocal: `2026-03-${day}T10:00:00` });
      return { externalID: `native-${day}`, icalUid: `uid-${day}`, etag: `W/"${day}"`, originalStart: allDay ? { kind: "date", value: time.start.toISOString().slice(0, 10) } : { kind: "instant", value: time.start.toISOString() }, values: { ...values, ...time, recurrence: null }, providerState: { ...state, eventType: "occurrence" } };
    }) };
    const rows = () => db.select().from(events).where(eq(events.creatorID, actor)).orderBy(events.id);
    const maps = () => db.select().from(externalEvents).where(eq(externalEvents.calendarID, calendar.id)).orderBy(externalEvents.id);
    const snapshot = async () => ({ rows: await rows(), maps: await maps(), history: await db.select().from(eventOutbox).where(eq(eventOutbox.userID, actor)) });
    const before = await snapshot();
    const commit = (observation = proof, lease = token) => completeGraphSeriesCreateOutbox(queued.operationID, lease, observation);
    for (const change of [
      (p: GraphFamilyObservation) => { p.instances.pop(); },
      (p: GraphFamilyObservation) => { delete p.master.creationOperationID; },
      (p: GraphFamilyObservation) => { p.master.creationOperationID = randomUUID(); },
      (p: GraphFamilyObservation) => { p.instances[1]!.externalID = p.instances[0]!.externalID; },
      (p: GraphFamilyObservation) => { p.instances[1]!.icalUid = p.instances[0]!.icalUid; },
      (p: GraphFamilyObservation) => { p.instances[1]!.originalStart = p.instances[0]!.originalStart; },
      (p: GraphFamilyObservation) => { p.master.values.title = "Concurrent master"; },
      (p: GraphFamilyObservation) => { p.master.values.recurrence = "RRULE:FREQ=DAILY;COUNT=5"; },
      (p: GraphFamilyObservation) => { p.instances[0]!.values.title = "Concurrent exception"; },
      (p: GraphFamilyObservation) => { p.instances[0]!.providerState.eventType = "exception"; },
      (p: GraphFamilyObservation) => { p.master.providerState.attendeesComplete = false; },
      (p: GraphFamilyObservation) => { p.master.providerState.isOrganizer = false; },
      (p: GraphFamilyObservation) => { p.instances[0]!.values.timeModel = { kind: "legacy-unknown" }; },
    ]) {
      const malformed = structuredClone(proof); change(malformed); assert.equal(await commit(malformed), false); assert.deepEqual(await snapshot(), before, "Failed proof rolls back master map, children and journal completion");
    }
    assert.equal(await commit(proof, randomUUID()), false); assert.deepEqual(await snapshot(), before);
    const [tombstone] = await db.insert(externalEventTombstones).values({ externalCalendarLinkID: link!.id, externalEventID: "native-29" }).returning();
    assert.equal(await commit(), false); assert.deepEqual(await snapshot(), before);
    await db.delete(externalEventTombstones).where(eq(externalEventTombstones.id, tombstone!.id));
    const otherID = randomUUID();
    await db.insert(events).values({ ...(await rows())[0]!, id: otherID, recurrence: null });
    const [collision] = await db.insert(externalEvents).values({ provider: "microsoft", calendarID: calendar.id, eventID: otherID, externalCalendarID: "calendar", externalEventID: "native-29", icalUid: "collision" }).returning();
    const collisionSnapshot = await snapshot(); assert.equal(await commit(), false); assert.deepEqual(await snapshot(), collisionSnapshot);
    await db.delete(externalEvents).where(eq(externalEvents.id, collision!.id)); await db.delete(events).where(eq(events.id, otherID));
    // Deterministically expire the already validated lease during family writes.
    // The final ACK must roll back every write, including this trigger's change.
    const trigger = `graph_ack_expire_${randomUUID().replace(/-/g, "")}`;
    await db.execute(sql.raw(`CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN UPDATE event_outbox SET lease_until = clock_timestamp() - interval '1 second' WHERE id = '${queued.operationID}'::uuid; RETURN NEW; END $$`));
    try {
      await db.execute(sql.raw(`CREATE TRIGGER ${trigger} AFTER UPDATE ON events FOR EACH ROW WHEN (NEW.id = '${event.id}'::uuid) EXECUTE FUNCTION ${trigger}()`));
      assert.equal(await commit(), false); assert.deepEqual(await snapshot(), before, "Lease expiry at final ACK rolls back the entire family");
    } finally {
      await db.execute(sql.raw(`DROP TRIGGER IF EXISTS ${trigger} ON events`));
      await db.execute(sql.raw(`DROP FUNCTION ${trigger}()`));
    }
    const results = await Promise.all([commit(), commit()]); assert.equal(results.filter(Boolean).length, 1);
    const accepted = await snapshot(); assert.equal(accepted.rows.length, 5); assert.equal(accepted.maps.length, 5);
    assert.equal(accepted.history[0]!.status, "completed"); assert.equal(accepted.history[0]!.uncertain, false);
    assert.equal(accepted.rows.find(row => !row.seriesID)!.id, event.id); assert.equal(new Set(accepted.maps.map(map => map.icalUid)).size, 5);
    assert.equal(expandRecurringEvents(accepted.rows, new Date(event.start.getTime() - 86400000), new Date(event.end.getTime() + 10 * 86400000), { consumerTimeZone: "UTC" }).length, 4);
    assert.equal(await commit(), false); assert.deepEqual(await snapshot(), accepted);
    const context = await readGraphFamilyContext({ userID: actor, accountID: "fixture", calendarID: calendar.id, externalMasterID: "master" });
    assert.equal((await replaceGraphFamily(context, proof)).changed, false); assert.deepEqual(await snapshot(), accepted);
    assert.equal(await upsertExternalEvent("microsoft", actor, calendar.id, "calendar", "new-stale-echo", { ...values, color: "red", recurrence: null }, null, "echo", undefined, undefined, undefined, undefined, undefined, "master"), false);
    assert.deepEqual(await snapshot(), accepted);
    console.log("Graph create ACK: complete personal footprint, atomic family/journal commit, rollback of partial/changed/colliding/deleted evidence, one lease winner, stable root/child IDs and ordinary sync no-op: OK");
  } finally { config.api.eventTimeEditsEnabled = flag; await db.delete(user).where(eq(user.id, actor)); }
}
async function main() { await run(false); await run(true); }
void main().catch(error => { console.error(error); process.exitCode = 1; });
