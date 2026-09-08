import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { eq } from "drizzle-orm";
import { resolveEventTimeEdit } from "@musubi/calendar";
import { applyLocalEventScope, createCalendar, db, events, user, calendarEvents, calendarMembers, externalEvents, eventScopeOperations } from "..";

async function main() {
  assert.equal(process.env.ENVIRONMENT, "test");
  const actor = `scope-${randomUUID()}`;
  await db.insert(user).values({ id: actor, name: actor, email: `${actor}@example.test` });
  try {
    const calendar = await createCalendar({ creatorID: actor, name: "Scope", color: "#112233" });
    const [master] = await db.insert(events).values({ id: randomUUID(), creatorID: actor, originCalendarID: calendar.id, organizer: "", title: "Daily", color: "#112233", recurrence: "RRULE:FREQ=DAILY;COUNT=4", ...resolveEventTimeEdit({ kind: "zoned", timeZone: "Europe/Prague", startLocal: "2026-03-28T09:00:00", endLocal: "2026-03-28T10:00:00" }) }).returning();
    await db.insert(calendarEvents).values({ eventID: master.id, calendarID: calendar.id });
    const request = { operationID: randomUUID(), expectedRevision: 1, scope: "occurrence", originalStart: { kind: "instant", value: "2026-03-29T07:00:00.000Z" }, expectedOccurrenceRevision: null, action: "update", patch: { title: "Moved" }, time: { kind: "zoned", timeZone: "Europe/Prague", startLocal: "2026-03-29T14:00:00", endLocal: "2026-03-29T16:00:00" } };
    const results = await Promise.all([applyLocalEventScope(master.id, actor, request), applyLocalEventScope(master.id, actor, request)]);
    assert.deepEqual(results.map(result => result.status).sort(), ["replayed", "saved"]);
    const saved = results.find(result => result.status === "saved")!;
    assert.equal(saved.outcome.events.length, 2);
    const child = saved.events.find(event => event.seriesID === master.id)!;
    assert.equal(child.end.getTime() - child.start.getTime(), 7200000);
    assert.equal(child.revision, 1);
    assert.equal(saved.events.find(event => event.id === master.id)!.revision, 2);
    await assert.rejects(applyLocalEventScope(master.id, actor, { ...request, patch: { title: "Different" } }), /already used/);
    const conflict = await applyLocalEventScope(master.id, actor, { ...request, operationID: randomUUID() });
    assert.equal(conflict.status, "conflict");
    const invalid = { ...request, operationID: randomUUID(), expectedRevision: 2, expectedOccurrenceRevision: undefined, scope: "series", originalStart: undefined, patch: { recurrence: "RRULE:FREQ=DAILY;COUNT=1" }, time: undefined };
    await assert.rejects(applyLocalEventScope(master.id, actor, invalid), /orphan/i);
    assert.equal((await db.select().from(eventScopeOperations).where(eq(eventScopeOperations.operationID, invalid.operationID))).length, 0);
    const edit = { operationID: randomUUID(), expectedRevision: 2, scope: "series", action: "update", patch: { title: "Winner" } };
    const race = await Promise.all([applyLocalEventScope(master.id, actor, edit), applyLocalEventScope(master.id, actor, { ...edit, operationID: randomUUID(), patch: { title: "Other" } })]);
    assert.deepEqual(race.map(result => result.status).sort(), ["conflict", "saved"]);
    const split = await applyLocalEventScope(master.id, actor, { operationID: randomUUID(), expectedRevision: 3, scope: "following", originalStart: request.originalStart, expectedOccurrenceRevision: 1, action: "update", patch: { title: "Future" } });
    assert.equal(split.status, "saved");
    if (split.status !== "saved") throw new Error("split failed");
    const head = split.events.find(event => event.id !== master.id && !event.seriesID)!;
    assert.equal(head.recurrence, "RRULE:FREQ=DAILY;COUNT=3");
    assert.equal(split.events.find(event => event.id === child.id)!.seriesID, head.id);
    const noop = await applyLocalEventScope(head.id, actor, { operationID: randomUUID(), expectedRevision: 1, scope: "series", action: "update", patch: { title: "Future" } });
    assert.equal(noop.status, "saved");
    if (noop.status === "saved") assert.equal(noop.outcome.changed, false);
    const removal = { operationID: randomUUID(), expectedRevision: 1, scope: "series", action: "delete" };
    const removed = await applyLocalEventScope(head.id, actor, removal);
    assert.equal(removed.status, "saved");
    if (removed.status === "saved") assert.equal(removed.outcome.deleted.length, 2);
    assert.equal((await applyLocalEventScope(head.id, actor, removal)).status, "replayed");
    // Durable receipt is observable from a separately opened connection.
    const connection = new Pool({ connectionString: process.env.DATABASE_URL });
    try {
      const receipt = await connection.query("select result from event_scope_operations where actor_id = $1 and operation_id = $2", [actor, removal.operationID]);
      assert.deepEqual(receipt.rows[0].result, removed.status === "saved" ? removed.outcome : null);
    } finally { await connection.end(); }
    // A tombstoned override is revived with its stable ID and current master links.
    const other = await createCalendar({ creatorID: actor, name: "Old link", color: "#112233" });
    const [revivalMaster] = await db.insert(events).values({ ...master, id: randomUUID() }).returning();
    await db.insert(calendarEvents).values({ eventID: revivalMaster.id, calendarID: calendar.id });
    const [dead] = await db.insert(events).values({ ...master, id: randomUUID(), seriesID: revivalMaster.id, recurrence: null, originalStart: request.originalStart as { kind: "instant"; value: string }, deletedAt: new Date() }).returning();
    await db.insert(calendarEvents).values({ eventID: dead.id, calendarID: other.id });
    const revived = await applyLocalEventScope(revivalMaster.id, actor, { ...request, operationID: randomUUID() });
    assert.equal(revived.status, "saved");
    if (revived.status === "saved") assert.equal(revived.events.find(event => event.seriesID)!.id, dead.id);
    assert.deepEqual((await db.select().from(calendarEvents).where(eq(calendarEvents.eventID, dead.id))).map(link => link.calendarID), [calendar.id]);
    await db.insert(externalEvents).values({ provider: "google", eventID: revivalMaster.id, calendarID: calendar.id, externalCalendarID: "fixture", externalEventID: "fixture" });
    await assert.rejects(applyLocalEventScope(revivalMaster.id, actor, { ...edit, operationID: randomUUID() }), /provider-aware/);
    // Adjacent identities may occupy each other's old slots during one shift.
    const [shiftMaster] = await db.insert(events).values({ ...master, id: randomUUID() }).returning();
    await db.insert(calendarEvents).values({ eventID: shiftMaster.id, calendarID: calendar.id });
    const shiftIDs = [randomUUID(), randomUUID()].sort();
    for (const [index, id] of shiftIDs.entries()) {
      await db.insert(events).values({ ...master, id, seriesID: shiftMaster.id, recurrence: null, originalStart: { kind: "instant", value: `2026-03-${29 + index}T07:00:00.000Z` } });
      await db.insert(calendarEvents).values({ eventID: id, calendarID: calendar.id });
    }
    const shifted = await applyLocalEventScope(shiftMaster.id, actor, { operationID: randomUUID(), expectedRevision: 1, scope: "series", action: "update", patch: {}, time: { kind: "zoned", timeZone: "Europe/Prague", startLocal: "2026-03-29T09:00:00", endLocal: "2026-03-29T10:00:00" } });
    assert.equal(shifted.status, "saved");
    if (shifted.status === "saved") assert.deepEqual(shifted.events.filter(event => event.seriesID).map(event => event.originalStart?.value).sort(), ["2026-03-30T07:00:00.000Z", "2026-03-31T07:00:00.000Z"]);
    const [reminderMaster] = await db.insert(events).values({ ...master, id: randomUUID() }).returning();
    await db.insert(calendarEvents).values({ eventID: reminderMaster.id, calendarID: calendar.id });
    const reminderIntent = { ...request, operationID: randomUUID(), time: undefined, patch: {}, ensureDefinition: true };
    const reminderResult = await applyLocalEventScope(reminderMaster.id, actor, reminderIntent);
    assert.equal(reminderResult.status, "saved");
    if (reminderResult.status === "saved") {
      assert.equal(reminderResult.outcome.changed, true);
      assert.equal(reminderResult.events.filter(event => event.seriesID).length, 1);
    }
    assert.equal((await applyLocalEventScope(reminderMaster.id, actor, reminderIntent)).status, "replayed");
    const editor = `scope-editor-${randomUUID()}`;
    await db.insert(user).values({ id: editor, name: editor, email: `${editor}@example.test` });
    try {
      await db.insert(calendarMembers).values({ userID: editor, calendarID: calendar.id, role: "editor" });
      const [legacy] = await db.insert(events).values({ ...master, id: randomUUID(), originCalendarID: null }).returning();
      await db.insert(calendarEvents).values({ eventID: legacy.id, calendarID: calendar.id });
      const [privateChild] = await db.insert(events).values({ ...master, id: randomUUID(), originCalendarID: null, seriesID: legacy.id, recurrence: null, title: "Private child", originalStart: request.originalStart as { kind: "instant"; value: string } }).returning();
      await db.insert(calendarEvents).values({ eventID: privateChild.id, calendarID: other.id });
      await assert.rejects(applyLocalEventScope(legacy.id, editor, { ...edit, expectedRevision: 1, operationID: randomUUID() }), /denied|permission|allowed/i);
      assert.equal((await db.select().from(events).where(eq(events.id, privateChild.id)))[0].revision, 1);
    } finally { await db.delete(user).where(eq(user.id, editor)); }
    await db.delete(calendarMembers).where(eq(calendarMembers.calendarID, calendar.id));
    await assert.rejects(applyLocalEventScope(head.id, actor, removal), /denied|permission|allowed/i);
  } finally {
    await db.delete(user).where(eq(user.id, actor));
  }
  console.log("Atomic scope integration: concurrent replay/CAS, rollback, split, no-op, deletion and permission recheck: OK");
}
main().finally(() => db.$client.end());
