import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { BadRequestError } from "@musubi/types";
import {
  createCalendar,
  createEvent,
  db,
  events,
  externalCalendars,
  eventOutbox,
  getEventSnapshot,
  replaceLocalEventTimeAtRevision,
  user,
} from "..";

async function main() {
  assert.equal(process.env.ENVIRONMENT, "test");
  const userID = `time-edit-${randomUUID()}`;
  await db
    .insert(user)
    .values({ id: userID, name: userID, email: `${userID}@example.test` });
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
