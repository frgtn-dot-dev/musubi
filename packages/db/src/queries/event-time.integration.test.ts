import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { BadRequestError, OccurrenceStartSchema } from "@musubi/types";
import {
  createCalendar,
  db,
  events,
  externalEvents,
  user,
  calendarEvents,
  getUsersEvents,
  patchEventAndCalendarLinks,
  getEventSnapshot,
  upsertExternalEvent,
  eventOutbox,
} from "..";

const constraint = (name: string) => (error: unknown) =>
  (error as { cause?: { constraint?: string } }).cause?.constraint === name;

async function main() {
  assert.equal(process.env.ENVIRONMENT, "test");
  const userID = `time-model-${randomUUID()}`;
  await db
    .insert(user)
    .values({ id: userID, name: userID, email: `${userID}@example.test` });
  try {
    const calendar = await createCalendar({
      creatorID: userID,
      name: "Time test",
      color: "#112233",
    });
    const secondCalendar = await createCalendar({
      creatorID: userID,
      name: "Other destination",
      color: "#112233",
    });
    const base = {
      creatorID: userID,
      title: "Legacy",
      color: "#112233",
      organizer: "owner",
      start: new Date("2026-09-07T09:00:00Z"),
      end: new Date("2026-09-07T10:00:00Z"),
    };
    const [legacy] = await db
      .insert(events)
      .values({ ...base, id: randomUUID() })
      .returning();
    assert.equal(legacy.timeModel, null);
    assert.equal(legacy.seriesID, null);
    assert.equal(legacy.originalStart, null);
    assert.equal(legacy.start.toISOString(), base.start.toISOString());
    assert.equal(legacy.revision, 1);
    const [series] = await db
      .insert(events)
      .values({
        ...base,
        id: randomUUID(),
        recurrence: "FREQ=WEEKLY",
        timeModel: {
          kind: "zoned",
          timeZone: "Europe/Prague",
          startLocal: "2026-09-07T11:00:00.000",
          endLocal: "2026-09-07T12:00:00.000",
        },
      })
      .returning();
    const originalStart = OccurrenceStartSchema.parse({
      kind: "instant",
      value: "2026-09-14T09:00:00Z",
    });
    const [exception] = await db
      .insert(events)
      .values({ ...base, id: randomUUID(), seriesID: series.id, originalStart })
      .returning();
    await db
      .update(events)
      .set({
        start: new Date("2026-09-15T09:00:00Z"),
        end: new Date("2026-09-15T10:00:00Z"),
      })
      .where(eq(events.id, exception.id));
    const [moved] = await db
      .select()
      .from(events)
      .where(eq(events.id, exception.id));
    assert.deepEqual(
      moved.originalStart,
      originalStart,
      "moving does not change the original identity",
    );
    // Range readers must provide definitions needed to replace an original
    // slot even when an exception has moved beyond the queried actual dates.
    await db.insert(calendarEvents).values(
      [legacy, series, exception].map((event) => ({
        eventID: event.id,
        calendarID: calendar.id,
      })),
    );
    const originalWindow = {
      start: new Date("2026-09-14T00:00:00Z"),
      end: new Date("2026-09-15T00:00:00Z"),
    };
    let ranged = await getUsersEvents(userID, originalWindow);
    assert.ok(
      ranged.some((row) => row.event.id === exception.id),
      "moved-out exception is included",
    );
    assert.ok(
      ranged.some((row) => row.event.id === series.id),
      "master is included",
    );
    assert.ok(
      !ranged.some((row) => row.event.id === legacy.id),
      "unrelated out-of-window timed event stays excluded",
    );
    await db
      .update(events)
      .set({ isCanceled: true })
      .where(eq(events.id, exception.id));
    ranged = await getUsersEvents(userID, originalWindow);
    assert.ok(
      ranged.some(
        (row) => row.event.id === exception.id && row.event.isCanceled,
      ),
      "cancellation definition survives range read",
    );
    assert.deepEqual(
      await getUsersEvents(`unrelated-${randomUUID()}`, originalWindow),
      [],
      "range completeness cannot bypass membership",
    );
    await db
      .update(events)
      .set({ deletedAt: new Date() })
      .where(eq(events.id, exception.id));
    assert.ok(
      !(await getUsersEvents(userID, originalWindow)).some(
        (row) => row.event.id === exception.id,
      ),
      "range read still excludes soft-deleted definitions",
    );
    assert.ok(
      (await getUsersEvents(userID, { since: new Date(0) })).some(
        (row) => row.event.id === exception.id && row.event.deletedAt,
      ),
      "delta read still returns deletion tombstones",
    );
    await db
      .update(events)
      .set({ deletedAt: null, isCanceled: false })
      .where(eq(events.id, exception.id));

    const [floating] = await db
      .insert(events)
      .values({
        ...base,
        id: randomUUID(),
        timeModel: {
          kind: "floating",
          startLocal: "2026-09-14T09:00:00.000",
          endLocal: "2026-09-14T10:00:00.000",
        },
      })
      .returning();
    const [allDay] = await db
      .insert(events)
      .values({
        ...base,
        id: randomUUID(),
        isAllDay: true,
        start: new Date("2026-09-14T00:00:00Z"),
        end: new Date("2026-09-14T00:00:00Z"),
        timeModel: { kind: "all-day" },
      })
      .returning();
    await db.insert(calendarEvents).values(
      [floating, allDay].map((event) => ({
        eventID: event.id,
        calendarID: calendar.id,
      })),
    );
    const viewerWindow = {
      start: new Date("2026-09-14T04:00:00Z"),
      end: new Date("2026-09-15T04:00:00Z"),
    };
    ranged = await getUsersEvents(userID, viewerWindow);
    assert.ok(
      ranged.some((row) => row.event.id === floating.id),
      "floating civil dates are not pruned by compatibility instants",
    );
    assert.ok(
      ranged.some((row) => row.event.id === allDay.id),
      "inclusive all-day date is retained in western viewer window",
    );
    const lateEvening = await getUsersEvents(userID, {
      start: new Date("2026-09-15T02:00:00Z"),
      end: new Date("2026-09-15T03:00:00Z"),
    });
    assert.ok(
      lateEvening.some((row) => row.event.id === allDay.id),
      "inclusive all-day date survives a late-evening New York sub-day window",
    );
    await assert.rejects(
      () =>
        db.insert(events).values({
          ...base,
          id: randomUUID(),
          seriesID: series.id,
          originalStart,
        }),
      constraint("events_series_original_start_unique"),
    );
    await assert.rejects(
      () =>
        db
          .insert(events)
          .values({ ...base, id: randomUUID(), seriesID: series.id }),
      constraint("events_occurrence_pair_check"),
    );
    await assert.rejects(
      () =>
        db.insert(events).values({ ...base, id: randomUUID(), originalStart }),
      constraint("events_occurrence_pair_check"),
    );
    const self = randomUUID();
    await assert.rejects(
      () =>
        db
          .insert(events)
          .values({ ...base, id: self, seriesID: self, originalStart }),
      constraint("events_occurrence_not_self_check"),
    );
    await assert.rejects(
      () =>
        db.insert(events).values({
          ...base,
          id: randomUUID(),
          seriesID: randomUUID(),
          originalStart,
        }),
      constraint("events_series_id_events_id_fk"),
    );
    await assert.rejects(
      () => db.delete(events).where(eq(events.id, series.id)),
      constraint("events_series_id_events_id_fk"),
      "master deletion cannot silently cascade exceptions",
    );
    // Legacy writers cannot change temporal content while retaining metadata
    // whose civil anchor or occurrence relationship would become stale.
    for (const candidate of [series, floating, allDay, exception]) {
      const before = (await getEventSnapshot(candidate.id))!;
      for (const patch of [
        { start: new Date("2026-10-01T09:00:00Z") },
        { end: new Date("2026-10-02T09:00:00Z") },
        { isAllDay: !before.isAllDay },
        { recurrence: "FREQ=MONTHLY" },
      ]) {
        await assert.rejects(
          () =>
            patchEventAndCalendarLinks(candidate.id, before.revision, {
              ...patch,
              title: "must roll back",
              calendars: [secondCalendar.id],
            }),
          (error: unknown) =>
            error instanceof BadRequestError &&
            /time-model-aware/.test(error.message),
        );
        assert.deepEqual(
          await getEventSnapshot(candidate.id),
          before,
          "rejected time update preserves content, revision and calendar links",
        );
        assert.deepEqual(
          await db
            .select()
            .from(eventOutbox)
            .where(eq(eventOutbox.eventID, candidate.id)),
          [],
        );
      }
      const noop = await patchEventAndCalendarLinks(
        candidate.id,
        before.revision,
        {
          start: new Date(before.start),
          end: new Date(before.end),
          isAllDay: before.isAllDay,
          recurrence: before.recurrence,
        },
      );
      assert.equal(noop.status, "saved");
      if (noop.status === "saved") assert.equal(noop.changed, false);
      const renamed = await patchEventAndCalendarLinks(
        candidate.id,
        before.revision,
        { title: "Renamed" },
      );
      assert.equal(renamed.status, "saved");
      if (renamed.status === "saved") {
        assert.deepEqual(renamed.event.timeModel, before.timeModel);
        assert.deepEqual(renamed.event.originalStart, before.originalStart);
      }
      assert.equal(
        (
          await patchEventAndCalendarLinks(candidate.id, before.revision, {
            start: new Date("2026-10-01T09:00:00Z"),
          })
        ).status,
        "conflict",
        "stale CAS still precedes time validation",
      );
    }
    // Generic removal cannot silently resurrect an exception's original slot
    // or strand visible children. No-op/content writes above remain valid.
    for (const candidate of [series, exception]) {
      const before = (await getEventSnapshot(candidate.id))!;
      await assert.rejects(() => patchEventAndCalendarLinks(candidate.id, before.revision, { calendars: [] }, true), /occurrence-aware scope/);
      assert.deepEqual(await getEventSnapshot(candidate.id), before);
      await assert.rejects(() => patchEventAndCalendarLinks(candidate.id, before.revision, { calendars: [] }, false), /occurrence-aware scope/);
      assert.deepEqual(await getEventSnapshot(candidate.id), before);
    }
    await db.update(events).set({ deletedAt: new Date() }).where(eq(events.id, exception.id));
    const masterBefore = (await getEventSnapshot(series.id))!;
    await assert.rejects(() => patchEventAndCalendarLinks(series.id, masterBefore.revision, { calendars: [] }, true), /occurrence-aware scope/);
    assert.deepEqual(await getEventSnapshot(series.id), masterBefore);
    await db.update(events).set({ deletedAt: null }).where(eq(events.id, exception.id));
    for (const timeModel of [null, { kind: "legacy-unknown" as const }]) {
      await db
        .update(events)
        .set({ timeModel })
        .where(eq(events.id, legacy.id));
      const current = (await getEventSnapshot(legacy.id))!;
      assert.equal(
        (
          await patchEventAndCalendarLinks(legacy.id, current.revision, {
            start: new Date(current.start.getTime() + 3600000),
          })
        ).status,
        "saved",
        "unresolved legacy behavior remains available",
      );
    }

    await db
      .update(events)
      .set({ originCalendarID: calendar.id })
      .where(eq(events.id, series.id));
    await db.insert(externalEvents).values({
      provider: "google",
      eventID: series.id,
      calendarID: calendar.id,
      externalCalendarID: "remote",
      externalEventID: "guarded-series",
      etag: "old",
    });
    const beforePull = (await getEventSnapshot(series.id))!;
    await assert.rejects(() =>
      upsertExternalEvent(
        "google",
        userID,
        calendar.id,
        "remote",
        "guarded-series",
        { ...beforePull, start: new Date("2026-10-01T09:00:00Z") },
        "new",
      ),
    );
    assert.deepEqual(await getEventSnapshot(series.id), beforePull);
    assert.equal(
      (
        await db
          .select()
          .from(externalEvents)
          .where(eq(externalEvents.eventID, series.id))
      )[0].etag,
      "old",
      "rejected legacy pull cannot acknowledge the new provider validator",
    );

    const mapping = {
      provider: "google",
      eventID: exception.id,
      externalCalendarID: "remote",
      externalEventID: "same-instance",
      externalSeriesID: "same-series",
      icalUid: "same-uid",
      originalStart,
    };
    await db.insert(externalEvents).values([
      { ...mapping, calendarID: calendar.id },
      { ...mapping, calendarID: secondCalendar.id },
    ]);
    const mappings = await db
      .select()
      .from(externalEvents)
      .where(eq(externalEvents.eventID, exception.id));
    assert.equal(
      mappings.length,
      2,
      "same provider series identity stays isolated by destination",
    );
    await assert.rejects(
      () =>
        db.insert(externalEvents).values({
          ...mapping,
          externalEventID: "orphan",
          externalSeriesID: null,
          calendarID: calendar.id,
        }),
      constraint("external_events_occurrence_series_check"),
    );
  } finally {
    await db.delete(user).where(eq(user.id, userID));
  }
  console.log("Event time storage integration: OK");
}
main().finally(() => db.$client.end());
