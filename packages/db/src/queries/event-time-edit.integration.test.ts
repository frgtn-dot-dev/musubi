import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { BadRequestError, EventWriteError } from "@musubi/types";
import {
  calendarMembers,
  createCalendar,
  createEvent,
  db,
  events,
  externalCalendars,
  eventOutbox,
  getEventSnapshot,
  replaceLocalEventTimeAtRevision as replaceTime,
  user,
} from "..";

async function main() {
  assert.equal(process.env.ENVIRONMENT, "test");
  const userID = `time-edit-${randomUUID()}`;
  await db
    .insert(user)
    .values({ id: userID, name: userID, email: `${userID}@example.test` });
  const replaceLocalEventTimeAtRevision = (id: string, revision: number, intent: unknown) => replaceTime(id, revision, intent, userID);
  try {
    const calendar = await createCalendar({
      creatorID: userID,
      name: "Local",
      color: "red",
    });
    const make = (extra = {}) =>
      createEvent(
        {
          id: randomUUID(),
          creatorID: userID,
          title: "Keep title",
          organizer: userID,
          color: "red",
          description: "Keep description",
          start: new Date("2026-03-28T09:00:00Z"),
          end: new Date("2026-03-28T10:00:00Z"),
          ...extra,
        },
        [calendar.id],
      );
    const event = await make({ recurrence: "FREQ=DAILY;COUNT=3" });
    const intent = {
      kind: "zoned",
      timeZone: "Europe/Prague",
      startLocal: "2026-03-29T02:30:00",
      endLocal: "2026-03-29T04:30:00",
    };
    // A permission decision made before the transaction cannot authorize a revoked role.
    await db.update(calendarMembers).set({ role: "viewer" }).where(eq(calendarMembers.calendarID, calendar.id));
    await assert.rejects(() => replaceTime(event.id, 1, intent, userID), EventWriteError);
    assert.deepEqual(await getEventSnapshot(event.id), { ...event, calendars: [calendar.id] });
    await db.update(calendarMembers).set({ role: "owner" }).where(eq(calendarMembers.calendarID, calendar.id));
    const first = await replaceLocalEventTimeAtRevision(event.id, 1, intent);
    assert.equal(first.status, "saved");
    if (first.status !== "saved") throw new Error("Time edit not saved");
    assert.equal(first.changed, true);
    assert.equal(first.event.revision, 2);
    assert.equal(first.event.start.toISOString(), "2026-03-29T01:30:00.000Z");
    assert.equal(first.event.end.toISOString(), "2026-03-29T02:30:00.000Z");
    assert.equal(
      first.event.timeModel?.kind === "zoned" &&
        first.event.timeModel.startLocal,
      "2026-03-29T02:30:00.000",
    );
    assert.equal(first.event.title, event.title);
    assert.equal(first.event.description, event.description);
    assert.equal(first.event.recurrence, event.recurrence);
    assert.deepEqual(await getEventSnapshot(event.id), first.event);
    const noop = await replaceLocalEventTimeAtRevision(event.id, 2, intent);
    assert.equal(noop.status, "saved");
    if (noop.status === "saved") assert.equal(noop.changed, false);
    assert.equal((await getEventSnapshot(event.id))?.revision, 2);
    const stale = await replaceLocalEventTimeAtRevision(event.id, 1, {
      invalid: true,
    });
    assert.equal(
      stale.status,
      "conflict",
      "CAS takes precedence over resolving stale input",
    );
    const before = await getEventSnapshot(event.id);
    await assert.rejects(
      () =>
        replaceLocalEventTimeAtRevision(event.id, 2, {
          ...intent,
          endLocal: "2026-03-29T03:00:00",
        }),
      BadRequestError,
    );
    assert.deepEqual(await getEventSnapshot(event.id), before);
    const concurrent = await Promise.all([
      replaceLocalEventTimeAtRevision(event.id, 2, {
        kind: "floating",
        startLocal: "2026-03-30T09:00:00",
        endLocal: "2026-03-30T10:00:00",
      }),
      replaceLocalEventTimeAtRevision(event.id, 2, {
        ...intent,
        startLocal: "2026-03-30T09:00:00",
        endLocal: "2026-03-30T10:00:00",
      }),
    ]);
    assert.equal(
      concurrent.filter((result) => result.status === "saved").length,
      1,
    );
    assert.equal(
      concurrent.filter((result) => result.status === "conflict").length,
      1,
    );
    assert.equal((await getEventSnapshot(event.id))?.revision, 3);

    const invalid = await make({ recurrence: "FREQ=HOURLY", isCanceled: true });
    const invalidBefore = await getEventSnapshot(invalid.id);
    await assert.rejects(
      () => replaceLocalEventTimeAtRevision(invalid.id, 1, intent),
      BadRequestError,
    );
    assert.deepEqual(await getEventSnapshot(invalid.id), invalidBefore);
    const parent = await make({ recurrence: "FREQ=DAILY" });
    const child = await make({
      seriesID: parent.id,
      originalStart: { kind: "instant", value: parent.start.toISOString() },
    });
    for (const candidate of [parent, child]) {
      await assert.rejects(
        () => replaceLocalEventTimeAtRevision(candidate.id, 1, intent),
        /occurrence-aware/,
      );
      assert.equal((await getEventSnapshot(candidate.id))?.revision, 1);
    }
    const allDay = await make();
    const converted = await replaceLocalEventTimeAtRevision(allDay.id, 1, {
      kind: "all-day",
      startDate: "2026-03-28",
      endDate: "2026-03-30",
    });
    assert.equal(converted.status, "saved");
    if (converted.status === "saved") {
      assert.equal(converted.event.isAllDay, true);
      assert.equal(
        converted.event.end.toISOString(),
        "2026-03-30T00:00:00.000Z",
      );
    }
    // One editor save is one revision: content and time cannot commit separately.
    const combined = await make();
    const combinedTime = { kind: "floating", startLocal: "2026-04-01T09:00:00", endLocal: "2026-04-01T10:00:00" };
    const beforeCombined = await getEventSnapshot(combined.id);
    await assert.rejects(() => replaceTime(combined.id, 1, combinedTime, userID, {
      title: "Must roll back", recurrence: "FREQ=HOURLY;COUNT=3",
    }), BadRequestError);
    assert.deepEqual(await getEventSnapshot(combined.id), beforeCombined);
    await assert.rejects(() => replaceTime(combined.id, 1, combinedTime, userID, { calendars: [] }));
    assert.deepEqual(await getEventSnapshot(combined.id), beforeCombined);
    const combinedSave = await replaceTime(combined.id, 1, combinedTime, userID, {
      title: "Complete draft", description: null, location: undefined, recurrence: "FREQ=DAILY;COUNT=2",
    });
    assert.equal(combinedSave.status, "saved");
    if (combinedSave.status !== "saved") throw new Error("Combined edit not saved");
    assert.equal(combinedSave.event.revision, 2);
    assert.equal(combinedSave.event.title, "Complete draft");
    assert.equal(combinedSave.event.description, null);
    assert.equal(combinedSave.event.location, combined.location);
    assert.equal(combinedSave.event.recurrence, "FREQ=DAILY;COUNT=2");
    assert.equal(combinedSave.event.timeModel?.kind, "floating");
    const combinedNoop = await replaceTime(combined.id, 2, combinedTime, userID, {
      title: "Complete draft", description: null, recurrence: "FREQ=DAILY;COUNT=2",
    });
    assert.equal(combinedNoop.status === "saved" && combinedNoop.changed, false);
    const staleCombined = await replaceTime(combined.id, 1, combinedTime, userID, { title: "Stale" });
    assert.equal(staleCombined.status, "conflict");
    assert.deepEqual(await getEventSnapshot(combined.id), combinedSave.event);
    // An existing unsupported rule can be explicitly replaced together with time.
    const repaired = await make({ recurrence: "FREQ=HOURLY;COUNT=3" });
    const repairedSave = await replaceTime(repaired.id, 1, combinedTime, userID, { recurrence: null });
    assert.equal(repairedSave.status === "saved" && repairedSave.event.recurrence, null);
    const drafts = [
      { title: "Draft A", time: { ...combinedTime, startLocal: "2026-04-02T09:00:00", endLocal: "2026-04-02T10:00:00" } },
      { title: "Draft B", time: { ...combinedTime, startLocal: "2026-04-03T09:00:00", endLocal: "2026-04-03T10:00:00" } },
    ];
    const raced = await Promise.all(drafts.map(draft => replaceTime(combined.id, 2, draft.time, userID, { title: draft.title })));
    assert.deepEqual(raced.map(result => result.status).sort(), ["conflict", "saved"]);
    const winnerIndex = raced.findIndex(result => result.status === "saved");
    const coherent = await getEventSnapshot(combined.id);
    assert.equal(coherent?.revision, 3);
    assert.equal(coherent?.title, drafts[winnerIndex]!.title);
    assert.equal(coherent?.timeModel?.kind === "floating" && coherent.timeModel.startLocal, `${drafts[winnerIndex]!.time.startLocal}.000`);
    await db
      .insert(externalCalendars)
      .values({
        provider: "google",
        userID,
        accountID: randomUUID(),
        externalCalendarID: "remote",
        calendarID: calendar.id,
      });
    await assert.rejects(
      () => replaceLocalEventTimeAtRevision(allDay.id, 2, intent),
      /provider write/,
    );
    assert.deepEqual(
      await getEventSnapshot(allDay.id),
      converted.status === "saved" ? converted.event : undefined,
    );
    assert.equal(
      (
        await db
          .select()
          .from(eventOutbox)
          .where(eq(eventOutbox.eventID, event.id))
      ).length,
      0,
    );
  } finally {
    await db.delete(user).where(eq(user.id, userID));
  }
  console.log("Local event time CAS integration: OK");
}
main().finally(() => db.$client.end());
