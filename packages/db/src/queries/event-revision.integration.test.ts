import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  calendarEvents, clearCalendarEvents, createCalendar, createEvent, db,
  deleteExternalEvent, events, externalEvents, getEvent, getEventCalendars,
  importExternalEvent, patchEventAndCalendarLinks, upsertExternalEvent, user,
} from "..";

// Explicit disposable PostgreSQL only; no credentials or provider HTTP calls.
async function main() {
  assert.equal(process.env.ENVIRONMENT, "test");
  const userID = `revision-${randomUUID()}`;
  await db.insert(user).values({ id: userID, name: userID, email: `${userID}@example.test` });
  try {
    const home = await createCalendar({ creatorID: userID, name: "Home", color: "#112233" });
    const copy = await createCalendar({ creatorID: userID, name: "Copy", color: "#112233" });
    const values = {
      title: "Baseline", color: "#112233", start: new Date("2026-01-01T09:00:00Z"),
      end: new Date("2026-01-01T10:00:00Z"), isAllDay: false, description: "keep me",
      location: "location", organizer: "organizer", recurrence: null, url: null,
    };
    const event = await createEvent({ id: randomUUID(), creatorID: userID, ...values, revision: 99 }, [home.id]);
    assert.equal(event.revision, 1, "new identity ignores supplied source revision");
    const movedStart = new Date("2026-01-02T09:00:00Z");
    const first = await patchEventAndCalendarLinks(event.id, 1, { start: movedStart });
    assert.equal(first.status, "saved");
    if (first.status !== "saved") throw new Error("first draft did not save");
    assert.equal(first.event.revision, 2);
    assert.deepEqual(Object.keys(first.patch), ["start"]);
    const stale = await patchEventAndCalendarLinks(event.id, 1, { title: "second draft", start: values.start });
    assert.equal(stale.status, "conflict");
    assert.equal((await getEvent(event.id)).start.getTime(), movedStart.getTime());
    assert.equal((await getEvent(event.id)).title, values.title);
    assert.equal((await patchEventAndCalendarLinks(event.id, 1, {})).status, "conflict", "stale no-op is not accepted");
    const noOp = await patchEventAndCalendarLinks(event.id, 2, { start: new Date(movedStart), calendars: [home.id, home.id] });
    assert.equal(noOp.status, "saved");
    if (noOp.status !== "saved") throw new Error("no-op did not save");
    assert.equal(noOp.changed, false);
    assert.equal(noOp.event.revision, 2);
    assert.equal(noOp.event.updatedAt.getTime(), first.event.updatedAt.getTime());
    const cleared = await patchEventAndCalendarLinks(event.id, 2, { description: null, location: undefined });
    assert.equal(cleared.status, "saved");
    assert.equal((await getEvent(event.id)).description, null);
    assert.equal((await getEvent(event.id)).location, "location", "omission must preserve location");
    await assert.rejects(() => patchEventAndCalendarLinks(event.id, undefined as unknown as number, {}), /expected event revision/);

    const raceRevision = (await getEvent(event.id)).revision;
    const racers = await Promise.all([
      patchEventAndCalendarLinks(event.id, raceRevision, { title: "race A", calendars: [home.id, copy.id] }),
      patchEventAndCalendarLinks(event.id, raceRevision, { title: "race B", calendars: [copy.id] }),
    ]);
    assert.deepEqual(racers.map((r) => r.status).sort(), ["conflict", "saved"]);
    const winner = racers.find((r) => r.status === "saved")!;
    if (winner.status !== "saved") throw new Error("no race winner");
    assert.equal(winner.event.revision, raceRevision + 1);
    assert.deepEqual((await getEventCalendars(event.id)).sort(), winner.event.calendars.sort(), "links and content share the winning CAS");
    await importExternalEvent("google", event.id, winner.event.calendars[0]!, "remote", "rollback-copy", '"rollback-v1"');
    await assert.rejects(() => patchEventAndCalendarLinks(event.id, winner.event.revision, {
      title: "must roll back", calendars: [randomUUID()],
    }));
    assert.equal((await db.select().from(externalEvents).where(eq(externalEvents.eventID, event.id))).length, 1,
      "failed link insertion rolls back removal of provider mappings too");
    assert.equal((await getEvent(event.id)).title, winner.event.title);
    assert.equal((await getEvent(event.id)).revision, winner.event.revision);
    assert.deepEqual((await getEventCalendars(event.id)).sort(), winner.event.calendars.sort());
    const deleted = await patchEventAndCalendarLinks(event.id, winner.event.revision, { calendars: [] }, true);
    assert.equal(deleted.status, "saved");
    assert.ok((await getEvent(event.id)).deletedAt);
    assert.equal((await getEvent(event.id)).revision, winner.event.revision + 1);
    assert.deepEqual(await getEventCalendars(event.id), []);
    assert.equal((await patchEventAndCalendarLinks(event.id, winner.event.revision, { title: "revive" })).status, "conflict");

    for (const provider of ["google", "microsoft", "caldav"]) {
      const remoteID = randomUUID();
      assert.equal(await upsertExternalEvent(provider, userID, home.id, "remote", remoteID, values, '"v1"'), true);
      const [mapping] = await db.select().from(externalEvents).where(eq(externalEvents.externalEventID, remoteID));
      const original = await getEvent(mapping.eventID);
      assert.equal(original.revision, 1);
      assert.equal(await upsertExternalEvent(provider, userID, home.id, "remote", remoteID, values, '"v2"'), false);
      const [versionOnly] = await db.select().from(externalEvents).where(eq(externalEvents.id, mapping.id));
      assert.equal(versionOnly.etag, '"v2"', "accepted provider version advances without a content revision");
      assert.equal(await upsertExternalEvent(provider, userID, home.id, "remote", remoteID, values), false, "no-validator identical polls stay quiet");
      const unchanged = await getEvent(mapping.eventID);
      assert.equal(unchanged.revision, 1);
      assert.equal(unchanged.updatedAt.getTime(), original.updatedAt.getTime());
      const [latestMapping] = await db.select().from(externalEvents).where(eq(externalEvents.id, mapping.id));
      assert.equal(latestMapping.etag, null, "accepted version metadata can change independently of content");
      const revisedValues = { ...values, title: "provider changed" };
      assert.equal(await upsertExternalEvent(provider, userID, home.id, "remote", remoteID, revisedValues, '"v3"'), true);
      assert.equal((await getEvent(mapping.eventID)).revision, 2);
      assert.equal((await patchEventAndCalendarLinks(mapping.eventID, 1, { title: "stale local" })).status, "conflict");
      // The local and inbound writers contend for the same event lock. Inbound
      // may follow a committed local write, but local CAS cannot overwrite a
      // version that inbound already advanced.
      const [localRace] = await Promise.all([
        patchEventAndCalendarLinks(mapping.eventID, 2, { location: "local" }),
        upsertExternalEvent(provider, userID, home.id, "remote", remoteID, { ...revisedValues, title: "inbound race" }, '"v4"'),
      ]);
      const raced = await getEvent(mapping.eventID);
      assert.equal(raced.title, "inbound race");
      assert.equal(raced.revision, localRace.status === "saved" ? 4 : 3);
      assert.equal(raced.location, values.location, "inbound ordering is not a merge or outbox guarantee");

      await db.insert(calendarEvents).values({ eventID: mapping.eventID, calendarID: copy.id });
      const copyID = randomUUID();
      await importExternalEvent(provider, mapping.eventID, copy.id, "remote", copyID, '"copy-v1"');
      const beforeReject = await getEvent(mapping.eventID);
      assert.equal(await upsertExternalEvent(provider, userID, copy.id, "remote", copyID, { ...values, title: "rejected mirror" }, '"copy-v2"'), false);
      assert.equal((await getEvent(mapping.eventID)).revision, beforeReject.revision);
      const [rejectedMapping] = await db.select().from(externalEvents).where(eq(externalEvents.externalEventID, copyID));
      assert.equal(rejectedMapping.etag, '"copy-v1"', "K01 rejected mirror version must not be acknowledged");
      assert.equal(await deleteExternalEvent(provider, copy.id, copyID), true);
      assert.equal((await getEvent(mapping.eventID)).revision, beforeReject.revision + 1);
      assert.equal((await getEvent(mapping.eventID)).deletedAt, null);
      assert.equal(await deleteExternalEvent(provider, home.id, remoteID), true);
      const tombstone = await getEvent(mapping.eventID);
      assert.equal(tombstone.revision, beforeReject.revision + 2);
      assert.equal(await deleteExternalEvent(provider, home.id, remoteID), false);
      assert.equal((await getEvent(mapping.eventID)).revision, tombstone.revision);
      assert.equal(await upsertExternalEvent(provider, userID, home.id, "remote", remoteID, values, '"revived"'), true);
      assert.equal((await getEvent(mapping.eventID)).revision, tombstone.revision + 1);
      assert.equal((await getEvent(mapping.eventID)).id, original.id);
      await clearCalendarEvents(home.id);
      const reset = await getEvent(mapping.eventID);
      await clearCalendarEvents(home.id);
      assert.equal((await getEvent(mapping.eventID)).revision, reset.revision, "repeated reset is a no-op");
    }
    console.log("event revision PostgreSQL integration: OK (CAS race, rollback, diff, no-op, inbound authority)");
  } finally {
    await db.delete(user).where(eq(user.id, userID));
  }
}
main().then(() => process.exit(0)).catch((error) => { console.error(error); process.exit(1); });
