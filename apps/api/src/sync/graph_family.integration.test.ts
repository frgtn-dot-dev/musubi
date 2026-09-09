import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { EventSchema } from "@musubi/types";
import { expandRecurringEvents, resolveEventTimeEdit } from "@musubi/calendar";
import { account, calendarEvents, calendarMembers, db, events, eventOutbox, externalCalendars, externalEvents, importExternalCalendar, readGraphFamilyContext, replaceGraphFamily, upsertExternalEvent, user, type GraphFamilyObservation } from "@musubi/db";
import { microsoftEventState } from "./adapters/provider_event_state";

async function main() {
  assert.equal(process.env.ENVIRONMENT, "test");
  const userID = `graph-family-${randomUUID()}`, accountID = "fixture", nativeMaster = "series/native";
  const state = microsoftEventState({ type: "seriesMaster", isCancelled: false, isOrganizer: true, organizer: { emailAddress: { address: "owner@example.test" } }, attendees: [], isReminderOn: true, reminderMinutesBeforeStart: 15, showAs: "busy", sensitivity: "normal", responseStatus: { response: "organizer" } });
  const values = { title: "Series", description: "Notes", location: "Office", organizer: "owner@example.test", recurrence: "RRULE:FREQ=DAILY;COUNT=4", url: null, ...resolveEventTimeEdit({ kind: "zoned", timeZone: "Europe/Prague", startLocal: "2026-03-27T09:00:00", endLocal: "2026-03-27T10:00:00" }) };
  await db.insert(user).values({ id: userID, name: "Fixture", email: `${userID}@example.test` });
  try {
    await db.insert(account).values({ id: randomUUID(), userId: userID, providerId: "microsoft", accountId: accountID, scope: "Calendars.ReadWrite", refreshToken: "fixture", accessToken: "fixture", accessTokenExpiresAt: new Date(Date.now() + 3600000) });
    const calendar = await importExternalCalendar("microsoft", userID, accountID, "Fixture", { externalId: "native-calendar", name: "Fixture", color: "red" });
    await upsertExternalEvent("microsoft", userID, calendar.id, "native-calendar", nativeMaster, { ...values, color: "red" }, 'W/"master"', "master-uid", undefined, { timeModel: values.timeModel }, undefined, state);
    const address = { userID, accountID, calendarID: calendar.id, externalMasterID: nativeMaster };
    const context = () => readGraphFamilyContext(address);
    const rows = () => db.select().from(events).where(eq(events.creatorID, userID)).orderBy(events.id);
    const maps = () => db.select().from(externalEvents).where(eq(externalEvents.calendarID, calendar.id)).orderBy(externalEvents.id);
    const snapshot = async () => ({ rows: await rows(), maps: await maps() });
    const occurrence = (day: number): GraphFamilyObservation["instances"][number] => {
      const time = resolveEventTimeEdit({ kind: "zoned", timeZone: "Europe/Prague", startLocal: `2026-03-${day}T09:00:00`, endLocal: `2026-03-${day}T10:00:00` });
      return { externalID: `native-${day}`, icalUid: `uid-${day}`, etag: `W/"${day}"`, originalStart: { kind: "instant", value: time.start.toISOString() }, values: { ...values, ...time, recurrence: null }, providerState: { ...state, eventType: "occurrence" } };
    };
    const observation: GraphFamilyObservation = { master: { externalID: nativeMaster, icalUid: "master-uid", etag: 'W/"master"', values, providerState: state }, instances: [27, 28, 29, 30].map(occurrence), cancelled: [] };
    const importFamily = async (proof = observation) => replaceGraphFamily(await context(), proof);
    assert.equal((await importFamily()).changed, true);
    const initial = await snapshot(), root = initial.rows.find(value => !value.seriesID)!;
    assert.equal(initial.rows.length, 5); assert.equal(initial.maps.length, 5);
    assert.equal(new Set(initial.maps.map(value => value.icalUid)).size, 5, "Graph occurrence UIDs are not the master's UID");
    const ids = new Map(initial.rows.filter(value => value.originalStart).map(value => [value.originalStart!.value, value.id]));
    const expanded = () => rows().then(all => expandRecurringEvents(all.filter(value => !value.deletedAt), new Date("2026-03-01Z"), new Date("2027-07-01Z"), { consumerTimeZone: "America/New_York" }));
    assert.equal((await expanded()).length, 4);
    assert.equal((await importFamily()).changed, false); assert.deepEqual(await snapshot(), initial, "Repeated observation is a true no-op");
    const moved = structuredClone(observation);
    moved.instances[1]!.values = { ...moved.instances[1]!.values, title: "Moved content", start: new Date("2027-05-01T12:00:00Z"), end: new Date("2027-05-01T13:00:00Z"), timeModel: { kind: "legacy-unknown" } };
    moved.instances[1]!.providerState = { ...state, eventType: "exception", privacy: "private" };
    assert.equal((await importFamily(moved)).changed, true);
    const acceptedMoved = (await rows()).find(value => value.id === ids.get(occurrence(28).originalStart.value))!;
    assert.equal(acceptedMoved.title, "Moved content"); assert.deepEqual(acceptedMoved.timeModel, { kind: "legacy-unknown" });
    const cancelled = structuredClone(moved), cancelledSlot = occurrence(28);
    cancelled.instances.splice(1, 1);
    cancelled.cancelled = [{ originalStart: cancelledSlot.originalStart, start: cancelledSlot.values.start, end: cancelledSlot.values.end, isAllDay: false, timeModel: cancelledSlot.values.timeModel }];
    cancelled.cancelled[0]!.originalStart = { kind: "instant", value: cancelledSlot.originalStart.value.replace(".000Z", "Z") };
    assert.equal((await importFamily(cancelled)).changed, true);
    const suppression = (await rows()).find(value => value.id === acceptedMoved.id)!;
    assert.equal((await rows()).length, 5); assert.equal(suppression.originalStart!.value, cancelledSlot.originalStart.value);
    assert.equal(suppression.isCanceled, true); assert.equal(suppression.title, acceptedMoved.title); assert.deepEqual(suppression.timeModel, acceptedMoved.timeModel); assert.deepEqual(suppression.start, acceptedMoved.start);
    assert.equal((await expanded()).length, 3); assert.equal((await maps()).length, 5, "Historical cancellation map stays in reset seen IDs");
    assert.ok((await importFamily(cancelled)).seenExternalIDs.includes("native-28"));
    const revived = structuredClone(moved); revived.instances[1]!.externalID = "native-28-revived"; revived.instances[1]!.icalUid = "revived-uid";
    revived.instances[1]!.originalStart = { kind: "instant", value: revived.instances[1]!.originalStart.value.replace(".000Z", "Z") };
    await importFamily(revived);
    assert.equal((await rows()).find(value => value.id === acceptedMoved.id)!.isCanceled, false);
    assert.equal((await maps()).find(value => value.externalEventID === "native-28-revived")!.eventID, acceptedMoved.id);
    assert.ok(!(await maps()).some(value => value.externalEventID === "native-28"));
    assert.equal((await expanded()).length, 4);
    const shorter = structuredClone(observation); shorter.master.values.recurrence = "RRULE:FREQ=DAILY;COUNT=2"; shorter.instances = shorter.instances.slice(0, 2);
    await importFamily(shorter);
    assert.equal((await rows()).filter(value => value.deletedAt).length, 2); assert.equal((await maps()).length, 3); assert.equal((await expanded()).length, 2);
    const retiredMap = initial.maps.find(value => value.externalEventID === "native-29")!;
    await db.insert(externalEvents).values(retiredMap);
    const beforeCleanup = await rows();
    assert.equal((await importFamily(shorter)).changed, true, "Cleaning a retained map on an already tombstoned child is a change");
    assert.deepEqual(await rows(), beforeCleanup, "Mapping-only cleanup does not bump canonical revisions");
    assert.equal((await maps()).length, 3); assert.equal((await importFamily(shorter)).changed, false);

    await importFamily(observation);
    assert.equal((await rows()).length, 5); assert.equal((await rows()).filter(value => value.deletedAt).length, 0);
    for (const value of (await rows()).filter(value => value.originalStart)) assert.equal(value.id, ids.get(value.originalStart!.value), "Rule revival preserves historical original UUIDs");
    const extended = structuredClone(observation), fifth = occurrence(31);
    extended.master.values.recurrence = "RRULE:FREQ=DAILY;COUNT=5";
    extended.cancelled = [{ originalStart: { kind: "instant", value: fifth.originalStart.value.replace(".000Z", "Z") }, start: fifth.values.start, end: fifth.values.end, isAllDay: false, timeModel: fifth.values.timeModel }];
    await importFamily(extended);
    const neverObserved = (await rows()).find(value => value.originalStart?.value === fifth.originalStart.value)!;
    assert.equal(neverObserved.isCanceled, true); assert.ok(!(await maps()).some(value => value.eventID === neverObserved.id), "Never invent a native ID for a missing slot");
    assert.equal((await expanded()).length, 4);
    const fullyRevived = structuredClone(extended); fullyRevived.instances.push(fifth); fullyRevived.cancelled = [];
    await importFamily(fullyRevived);
    assert.equal((await maps()).find(value => value.externalEventID === fifth.externalID)!.eventID, neverObserved.id);
    assert.equal((await expanded()).length, 5);
    // Normalize historical valid representations as well as incoming ones.
    const historical = (await rows()).find(value => value.originalStart?.value === occurrence(27).originalStart.value)!;
    await db.update(events).set({ originalStart: { kind: "instant", value: historical.originalStart!.value.replace(".000Z", "Z") } }).where(eq(events.id, historical.id));
    await importFamily(fullyRevived);
    assert.equal((await rows()).find(value => value.id === historical.id)!.originalStart!.value, occurrence(27).originalStart.value);
    const duplicateID = randomUUID();
    await db.insert(events).values({ ...historical, id: duplicateID, originalStart: { kind: "instant", value: historical.originalStart!.value.replace(".000Z", "Z") }, isCanceled: true });
    await db.insert(calendarEvents).values({ eventID: duplicateID, calendarID: calendar.id });
    await assert.rejects(context, "Pre-existing equivalent original identities must not be accepted as two children");
    await db.delete(events).where(eq(events.id, duplicateID));
    // Every malformed or incomplete replacement rolls back the whole family.
    const safe = await snapshot();
    for (const mutate of [
      (value: GraphFamilyObservation) => { value.master.icalUid = "other-master-uid"; },
      (value: GraphFamilyObservation) => { value.instances.pop(); },
      (value: GraphFamilyObservation) => { value.instances[1]!.originalStart = value.instances[0]!.originalStart; },
      (value: GraphFamilyObservation) => { value.instances[1]!.externalID = value.instances[0]!.externalID; },
      (value: GraphFamilyObservation) => { value.instances[1]!.externalID = nativeMaster; },
      (value: GraphFamilyObservation) => { value.master.values.recurrence = "RRULE:FREQ=DAILY;COUNT=367"; },
      (value: GraphFamilyObservation) => { value.master.values.recurrence = "RRULE:FREQ=YEARLY;COUNT=5"; },
      (value: GraphFamilyObservation) => { value.instances[1]!.values.end = new Date(NaN); },
      (value: GraphFamilyObservation) => { value.instances[1]!.values.timeModel = { kind: "all-day" }; },
      (value: GraphFamilyObservation) => { value.master.values.title = "Would be partial"; value.instances[4]!.providerState = { ...state, provider: "google" } as any; },
    ]) { const invalid = structuredClone(fullyRevived); mutate(invalid); await assert.rejects(() => importFamily(invalid)); assert.deepEqual(await snapshot(), safe); }
    const stale = await context();
    await db.update(events).set({ title: "Concurrent local", revision: sql`${events.revision} + 1` }).where(eq(events.id, root.id));
    const afterLocal = await snapshot(); await assert.rejects(() => replaceGraphFamily(stale, fullyRevived)); assert.deepEqual(await snapshot(), afterLocal);
    await importFamily(fullyRevived);
    const beforePending = await context(), pendingID = randomUUID();
    await db.insert(eventOutbox).values({ id: pendingID, actorID: userID, mutationID: randomUUID(), position: 0, eventID: root.id, revision: beforePending.root.revision, calendarID: calendar.id, externalCalendarLinkID: beforePending.link.id, provider: "microsoft", userID, accountID, externalCalendarID: "native-calendar", action: "update", payload: { event: EventSchema.parse({ ...beforePending.root, calendars: [calendar.id] }), patch: { title: "Pending" } } });
    await assert.rejects(context); await assert.rejects(() => replaceGraphFamily(beforePending, fullyRevived));
    await db.update(eventOutbox).set({ status: "cancelled", errorCode: "superseded-by-resolution" }).where(eq(eventOutbox.id, pendingID));
    await assert.rejects(context, "A cancelled row alone does not prove completed resolution");
    const replacementID = randomUUID();
    await db.insert(eventOutbox).values({ id: replacementID, actorID: userID, mutationID: randomUUID(), position: 0, eventID: root.id, revision: beforePending.root.revision, calendarID: calendar.id, externalCalendarLinkID: beforePending.link.id, provider: "microsoft", userID, accountID, externalCalendarID: "native-calendar", action: "update", payload: { event: EventSchema.parse({ ...beforePending.root, calendars: [calendar.id] }), resolution: { operationID: pendingID, replacedOperationIDs: [pendingID], expectedLocalRevision: beforePending.root.revision, expectedLatestOperationID: pendingID, expectedRemoteExists: true, expectedRemoteEtag: null } } });
    await assert.rejects(context, "An unfinished replacement remains pending");
    await db.update(eventOutbox).set({ status: "completed", externalCalendarLinkID: randomUUID() }).where(eq(eventOutbox.id, replacementID));
    await assert.rejects(context, "A replacement on another connection cannot release source history");
    await db.update(eventOutbox).set({ externalCalendarLinkID: beforePending.link.id }).where(eq(eventOutbox.id, replacementID));
    assert.equal((await importFamily(fullyRevived)).changed, false, "Completed exact replacement releases retained cancelled history");
    const beforeGrant = await context();
    await db.update(calendarMembers).set({ role: "viewer" }).where(eq(calendarMembers.calendarID, calendar.id));
    await assert.rejects(() => replaceGraphFamily(beforeGrant, fullyRevived));
    await db.update(calendarMembers).set({ role: "owner" }).where(eq(calendarMembers.calendarID, calendar.id));
    await db.update(externalCalendars).set({ disabled: true }).where(eq(externalCalendars.id, beforeGrant.link.id)); await assert.rejects(context);
    await db.update(externalCalendars).set({ disabled: false }).where(eq(externalCalendars.id, beforeGrant.link.id));
    await db.update(account).set({ syncStatus: "reconnect_required" }).where(eq(account.userId, userID)); await assert.rejects(context);
    await db.update(account).set({ syncStatus: "active", refreshToken: null }).where(eq(account.userId, userID)); await assert.rejects(context);
    await db.update(account).set({ refreshToken: "fixture" }).where(eq(account.userId, userID));
    await assert.rejects(() => readGraphFamilyContext({ ...address, accountID: "foreign" }));
    await assert.rejects(() => readGraphFamilyContext({ ...address, userID: "foreign" }));
    const raceContext = await context(), raced = structuredClone(fullyRevived); raced.master.values.title = "Exactly once";
    const races = await Promise.allSettled([replaceGraphFamily(raceContext, raced), replaceGraphFamily(raceContext, raced)]);
    assert.equal(races.filter(value => value.status === "fulfilled").length, 1); assert.equal(races.filter(value => value.status === "rejected").length, 1);
    assert.equal((await rows()).find(value => value.id === root.id)!.revision, raceContext.root.revision + 1);
    // A native ID already owned by another event cannot be adopted into this family.
    await upsertExternalEvent("microsoft", userID, calendar.id, "native-calendar", "foreign-native", { ...values, recurrence: null, title: "Other event", color: "red" }, 'W/"other"', "foreign-uid");
    const beforeCollision = await snapshot(), collision = structuredClone(fullyRevived);
    collision.instances[0]!.externalID = "foreign-native";
    await assert.rejects(() => importFamily(collision)); assert.deepEqual(await snapshot(), beforeCollision);
    const beforeMap = await context();
    await db.update(externalEvents).set({ etag: 'W/"concurrent-map"' }).where(eq(externalEvents.id, beforeMap.mappings.find(value => value.eventID !== root.id)!.id));
    await assert.rejects(() => replaceGraphFamily(beforeMap, fullyRevived));
    // Date identities and inclusive year-boundary ends stay dates in storage.
    const dayTime = resolveEventTimeEdit({ kind: "all-day", startDate: "2026-12-31", endDate: "2027-01-01" });
    const dayValues = { ...values, ...dayTime, recurrence: "RRULE:FREQ=DAILY;COUNT=2" };
    await upsertExternalEvent("microsoft", userID, calendar.id, "native-calendar", "day-series", { ...dayValues, color: "red" }, 'W/"day"', "day-master-uid", undefined, { timeModel: dayTime.timeModel }, undefined, state);
    const dayContext = await readGraphFamilyContext({ ...address, externalMasterID: "day-series" });
    const dayProof: GraphFamilyObservation = {
      master: { externalID: "day-series", icalUid: "day-master-uid", etag: 'W/"day"', values: dayValues, providerState: state },
      instances: [{ externalID: "day-instance", icalUid: "day-instance-uid", etag: 'W/"day-instance"', values: { ...dayValues, recurrence: null }, originalStart: { kind: "date", value: "2026-12-31" }, providerState: { ...state, eventType: "occurrence" } }],
      cancelled: [{ originalStart: { kind: "date", value: "2027-01-01" }, ...resolveEventTimeEdit({ kind: "all-day", startDate: "2027-01-01", endDate: "2027-01-02" }) }],
    };
    await replaceGraphFamily(dayContext, dayProof);
    const days = (await rows()).filter(value => value.seriesID === dayContext.root.id);
    assert.equal(days.length, 2); assert.ok(days.every(value => value.isAllDay && value.timeModel?.kind === "all-day"));
    assert.equal(days.find(value => !value.isCanceled)!.end.toISOString(), "2027-01-01T00:00:00.000Z");
    assert.equal(days.find(value => value.isCanceled)!.end.toISOString(), "2027-01-02T00:00:00.000Z");
    console.log("Private Graph family DB import: atomic complete replacement, stable UUIDs/native UIDs, moved unknown-zone exceptions, cancellation preservation and unmapped slots, rule retirement/revival, no-op, rollback, local/pending/permission/account fences and concurrent one-winner commit: OK");
  } finally { await db.delete(user).where(eq(user.id, userID)); }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
