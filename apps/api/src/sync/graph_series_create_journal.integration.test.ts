import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { config } from "@musubi/config";
import { EventSchema } from "@musubi/types";
import { resolveEventTimeEdit } from "@musubi/calendar";
import { account, calendarMembers, db, events, externalCalendars, externalEvents, eventOutbox, user, importExternalCalendar, upsertExternalEvent, deleteExternalEvent, sweepExternalEvents, queueGraphSeriesCreate, claimEventOutbox, confirmGraphSeriesCreateOutbox, completeEventOutbox, finishEventOutbox, listGraphFamilyContexts, getUserExternalCalendars, getEventDeliveryResolutionContext } from "@musubi/db";
import { microsoftAdapter } from "./adapters/microsoft";
import { syncProvider } from "./engine";

async function main() {
  assert.equal(process.env.ENVIRONMENT, "test");
  const userID = `graph-create-journal-${randomUUID()}`, accountID = "fixture", savedFlag = config.api.eventTimeEditsEnabled;
  await db.insert(user).values({ id: userID, name: "Fixture", email: `${userID}@example.test` });
  try {
    const connectionID = randomUUID();
    await db.insert(account).values({ id: connectionID, userId: userID, providerId: "microsoft", accountId: accountID, scope: "Calendars.ReadWrite", refreshToken: "fixture", accessToken: "fixture" });
    const calendar = await importExternalCalendar("microsoft", userID, accountID, "Fixture", { externalId: "native-calendar", name: "Fixture", color: "red" });
    const event = EventSchema.parse({ id: randomUUID(), revision: 1, creatorID: userID, organizer: userID, title: "Personal", color: "red", calendars: [calendar.id], originCalendarID: calendar.id, isCanceled: false, recurrence: "RRULE:FREQ=DAILY;COUNT=4", ...resolveEventTimeEdit({ kind: "zoned", timeZone: "Europe/Prague", startLocal: "2026-03-27T09:00:00", endLocal: "2026-03-27T10:00:00" }) });
    const operationID = randomUUID();
    const rows = () => db.select().from(events).where(eq(events.creatorID, userID)).orderBy(events.id);
    const history = () => db.select().from(eventOutbox).where(eq(eventOutbox.userID, userID));
    config.api.eventTimeEditsEnabled = false;
    await assert.rejects(() => queueGraphSeriesCreate(userID, operationID, event)); assert.equal((await rows()).length, 0);
    config.api.eventTimeEditsEnabled = true;
    for (const patch of [{ hasAttendees: true }, { organizer: "someone@example.test" }, { url: "https://meeting.test" }, { isCanceled: true }, { recurrence: "RRULE:FREQ=DAILY" }, { recurrence: "RRULE:FREQ=DAILY;COUNT=367" }, { timeModel: { kind: "legacy-unknown" } }]) {
      await assert.rejects(() => queueGraphSeriesCreate(userID, randomUUID(), { ...event, ...patch }));
    }
    await db.update(calendarMembers).set({ role: "viewer" }).where(eq(calendarMembers.calendarID, calendar.id));
    await assert.rejects(() => queueGraphSeriesCreate(userID, operationID, event));
    assert.equal((await rows()).length, 0); assert.equal((await history()).length, 0);
    await db.update(calendarMembers).set({ role: "owner" }).where(eq(calendarMembers.calendarID, calendar.id));
    const [first, replay] = await Promise.all([queueGraphSeriesCreate(userID, operationID, event), queueGraphSeriesCreate(userID, operationID, event)]);
    assert.deepEqual(first, replay); assert.equal((await rows()).length, 1); assert.equal((await history()).length, 1);
    const intent = (await history())[0]!;
    assert.equal(intent.id, first.operationID); assert.equal(intent.mutationID, operationID);
    assert.equal(intent.payload.graphSeriesCreate!.nativeEvent.organizer, ""); assert.equal(intent.payload.event.organizer, userID);
    assert.equal(intent.status, "pending"); assert.equal(intent.uncertain, false);
    assert.deepEqual(await queueGraphSeriesCreate(userID, operationID.toUpperCase(), { ...event, id: event.id.toUpperCase(), calendars: [calendar.id.toUpperCase()], originCalendarID: calendar.id.toUpperCase() }), first);
    await assert.rejects(() => queueGraphSeriesCreate(userID, operationID, { ...event, title: "Changed retry" }));
    await assert.rejects(() => queueGraphSeriesCreate(userID, randomUUID(), event));
    assert.equal((await history()).length, 1);
    const before = await rows();
    const importEcho = () => upsertExternalEvent("microsoft", userID, calendar.id, "native-calendar", "unknown-instance", { title: event.title, color: event.color, start: event.start, end: event.end, isAllDay: event.isAllDay, description: event.description ?? null, location: event.location ?? null, url: event.url ?? null, organizer: "owner@example.test", recurrence: null }, null, "uid");
    for (const status of ["pending", "unconfirmed", "cancelled", "conflict"] as const) {
      await db.update(eventOutbox).set({ status }).where(eq(eventOutbox.id, intent.id));
      await assert.rejects(importEcho);
      await assert.rejects(() => getEventDeliveryResolutionContext(userID, event.id, intent.id));
      await assert.rejects(() => deleteExternalEvent("microsoft", calendar.id, "unknown-instance"));
      await assert.rejects(() => listGraphFamilyContexts(userID, accountID, calendar.id));
    }
    await db.update(eventOutbox).set({ status: "pending" }).where(eq(eventOutbox.id, intent.id));
    let fetched = false;
    const adapter = { ...microsoftAdapter, listCalendars: async () => ({ calendars: [{ externalId: "native-calendar", name: "Fixture", color: "red" }], taskListsComplete: true }), fetchChanges: async () => { fetched = true; return { changes: [], nextCursor: "wrong", reset: false }; } };
    const cursor = (await getUserExternalCalendars("microsoft", userID, accountID))[0]!.cursor;
    await assert.rejects(() => syncProvider(adapter, userID, { id: accountID, label: "Fixture" }));
    assert.equal(fetched, false); assert.equal((await getUserExternalCalendars("microsoft", userID, accountID))[0]!.cursor, cursor);
    assert.deepEqual(await rows(), before); assert.equal((await db.select().from(externalEvents).where(eq(externalEvents.calendarID, calendar.id))).length, 0);
    const claimed = (await claimEventOutbox(intent.id))!;
    assert.equal(claimed.reconciling, false); assert.equal(claimed.uncertain, true);
    const token = claimed.leaseToken!;
    assert.equal(await confirmGraphSeriesCreateOutbox(intent.id, token), true);
    assert.equal(await confirmGraphSeriesCreateOutbox(intent.id, randomUUID()), false);
    assert.equal(await completeEventOutbox(intent.id, token, { externalEventId: "native", icalUid: "uid" }, null), undefined, "A master-only ACK cannot release the family journal");
    assert.equal((await history())[0]!.status, "attempting");
    for (const [table, where, patch, restore] of [
      [events, eq(events.id, event.id), { revision: 2 }, { revision: 1 }],
      [events, eq(events.id, event.id), { title: "Changed locally" }, { title: event.title }],
      [events, eq(events.id, event.id), { deletedAt: new Date() }, { deletedAt: null }],
      [calendarMembers, eq(calendarMembers.calendarID, calendar.id), { role: "viewer" }, { role: "owner" }],
      [externalCalendars, eq(externalCalendars.calendarID, calendar.id), { disabled: true }, { disabled: false }],
      [account, eq(account.id, connectionID), { scope: "User.Read" }, { scope: "Calendars.ReadWrite" }],
      [account, eq(account.id, connectionID), { refreshToken: null }, { refreshToken: "fixture" }],
      [eventOutbox, eq(eventOutbox.id, intent.id), { leaseUntil: new Date(0) }, { leaseUntil: new Date(Date.now() + 120000) }],
    ] as const) {
      await db.update(table as typeof events).set(patch as Partial<typeof events.$inferInsert>).where(where);
      assert.equal(await confirmGraphSeriesCreateOutbox(intent.id, token), false);
      await db.update(table as typeof events).set(restore as Partial<typeof events.$inferInsert>).where(where);
      assert.equal(await confirmGraphSeriesCreateOutbox(intent.id, token), true);
    }
    const [premature] = await db.insert(externalEvents).values({ provider: "microsoft", eventID: event.id, calendarID: calendar.id, externalCalendarID: "native-calendar", externalEventID: "premature-master", icalUid: "premature-uid" }).returning();
    assert.equal(await confirmGraphSeriesCreateOutbox(intent.id, token), false);
    await db.delete(externalEvents).where(eq(externalEvents.id, premature!.id));
    const childID = randomUUID();
    await db.insert(events).values({ ...(await rows())[0]!, id: childID, seriesID: event.id, recurrence: null, originalStart: { kind: "instant", value: event.start.toISOString() } });
    assert.equal(await confirmGraphSeriesCreateOutbox(intent.id, token), false);
    await db.delete(events).where(eq(events.id, childID));
    assert.equal(await confirmGraphSeriesCreateOutbox(intent.id, token), true);
    config.api.eventTimeEditsEnabled = false; assert.equal(await confirmGraphSeriesCreateOutbox(intent.id, token), false); config.api.eventTimeEditsEnabled = true;
    assert.equal(await finishEventOutbox(intent.id, token, "unconfirmed", "provider-write-failed"), true);
    const retry = (await claimEventOutbox(intent.id))!;
    assert.equal(retry.id, intent.id); assert.equal(retry.reconciling, true); assert.notEqual(retry.leaseToken, token);
    assert.equal(await confirmGraphSeriesCreateOutbox(intent.id, token), false); assert.equal(await confirmGraphSeriesCreateOutbox(intent.id, retry.leaseToken!), true);
    // Only a terminal proof can release admission. This fixture simulates that
    // state; it is not a native write or a substitute for the forthcoming ACK.
    await db.update(eventOutbox).set({ status: "not-needed", uncertain: false }).where(eq(eventOutbox.id, intent.id));
    assert.equal(await importEcho(), true);
    assert.equal(await sweepExternalEvents("microsoft", calendar.id, []), 1);
    const lateAdapter = { ...adapter, fetchChanges: async () => {
      await queueGraphSeriesCreate(userID, randomUUID(), { ...event, id: randomUUID(), title: "Late admission" });
      return { changes: [{ kind: "event" as const, data: { externalId: "late-native", status: "active" as const, title: "Unconfirmed echo", start: event.start, end: event.end, isAllDay: false, description: null, location: null, organizer: null, recurrence: null, url: null } }], nextCursor: "must-not-advance", reset: false };
    } };
    await assert.rejects(() => syncProvider(lateAdapter, userID, { id: accountID, label: "Fixture" }));
    assert.equal((await getUserExternalCalendars("microsoft", userID, accountID))[0]!.cursor, cursor);
    assert.ok(!(await rows()).some(row => row.title === "Unconfirmed echo"), "Admission during fetch is rechecked before ordinary import");
    console.log("Graph create journal: atomic replay, personal admission, pending import/cursor fence, durable uncertainty, exact lease/source checks and generic ACK refusal: OK");
  } finally { config.api.eventTimeEditsEnabled = savedFlag; await db.delete(user).where(eq(user.id, userID)); }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
