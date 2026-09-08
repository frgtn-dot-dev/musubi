import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import {
  db,
  user,
  createCalendar,
  calendarMembers,
  externalCalendars,
  externalEvents,
  eventOutbox,
  events,
  appendEventOutbox,
  claimEventOutbox,
  getEventSnapshot,
  providerStateVersion,
  queueProviderReminderEdit,
  upsertExternalEvent,
} from "@musubi/db";
import { googleEventState } from "./adapters/provider_event_state";
import { deliverEventOutbox } from "./event_delivery";

async function main() {
  assert.equal(process.env.ENVIRONMENT, "test");
  const owner = `native-reminder-${randomUUID()}`;
  const other = `native-reminder-other-${randomUUID()}`;
  for (const id of [owner, other])
    await db.insert(user).values({ id, name: id, email: `${id}@example.test` });
  try {
    const calendar = await createCalendar({
      creatorID: owner,
      name: "Source",
      color: "red",
    });
    await db
      .insert(calendarMembers)
      .values({ calendarID: calendar.id, userID: other, role: "editor" });
    await db
      .insert(externalCalendars)
      .values({
        provider: "google",
        userID: owner,
        accountID: randomUUID(),
        calendarID: calendar.id,
        externalCalendarID: "source",
      });
    const state = googleEventState({
      organizer: { email: "host@example.test", self: false },
      reminders: { useDefault: true },
    });
    await upsertExternalEvent(
      "google",
      owner,
      calendar.id,
      "source",
      "meeting",
      {
        title: "Guest copy",
        color: "red",
        start: new Date("2026-09-10T09:00:00Z"),
        end: new Date("2026-09-10T10:00:00Z"),
        isAllDay: false,
        description: "Keep",
        location: null,
        organizer: "host@example.test",
        recurrence: null,
        url: null,
      },
      '"v1"',
      null,
      undefined,
      undefined,
      undefined,
      state,
    );
    const [mapping] = await db
      .select()
      .from(externalEvents)
      .where(eq(externalEvents.calendarID, calendar.id));
    const event = (await getEventSnapshot(mapping.eventID))!;
    const request = {
      provider: "google",
      operationID: randomUUID(),
      expectedRevision: event.revision,
      expectedStateVersion: providerStateVersion(mapping),
      reminders: {
        useDefault: false,
        overrides: [{ method: "popup", minutes: 0 }],
      },
    };
    await assert.rejects(
      queueProviderReminderEdit(owner, event.id, {
        ...request,
        expectedRevision: event.revision! + 1,
      }),
      /settings changed/,
    );
    await assert.rejects(
      queueProviderReminderEdit(other, event.id, request),
      /connected source account/,
    );
    await assert.rejects(
      queueProviderReminderEdit(owner, event.id, {
        ...request,
        expectedStateVersion: "0".repeat(64),
      }),
      /settings changed/,
    );
    await assert.rejects(
      queueProviderReminderEdit(owner, event.id, {
        ...request,
        reminders: {
          useDefault: false,
          overrides: [{ method: "sms", minutes: 0 }],
        },
      }),
    );
    await assert.rejects(
      queueProviderReminderEdit(owner, event.id, { ...request, attendees: [] }),
    );
    const results = await Promise.all([
      queueProviderReminderEdit(owner, event.id, request),
      queueProviderReminderEdit(owner, event.id, request),
    ]);
    assert.deepEqual(results.map((result) => result.replayed).sort(), [
      false,
      true,
    ]);
    assert.equal(results[0].operationID, results[1].operationID);
    assert.deepEqual(
      await getEventSnapshot(event.id),
      event,
      "no content, revision, time or social mutation",
    );
    const rows = await db
      .select()
      .from(eventOutbox)
      .where(eq(eventOutbox.eventID, event.id));
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0].payload.reminderEdit, request);
    await assert.rejects(
      queueProviderReminderEdit(owner, event.id, {
        ...request,
        reminders: { useDefault: true },
      }),
      /already used/,
    );
    await assert.rejects(
      queueProviderReminderEdit(owner, event.id, {
        ...request,
        operationID: randomUUID(),
      }),
      /pending operation/,
    );
    const delivered = await deliverEventOutbox(rows[0].id, () => null);
    assert.equal(
      delivered?.status,
      "blocked",
      "unimplemented native intent must not reach legacy content serialization",
    );
    await db
      .update(eventOutbox)
      .set({ status: "cancelled" })
      .where(eq(eventOutbox.id, rows[0].id));
    await assert.rejects(
      queueProviderReminderEdit(owner, event.id, {
        ...request,
        operationID: randomUUID(),
      }),
      /previous source operation was cancelled/,
    );
    assert.equal(
      (
        await db
          .select()
          .from(eventOutbox)
          .where(eq(eventOutbox.eventID, event.id))
      ).length,
      1,
    );
    // Different operations serialize on the same event, so only one is queued.
    await db.delete(eventOutbox).where(eq(eventOutbox.id, rows[0].id));
    for (const unsupported of [
      { timeModel: { kind: "zoned" as const, timeZone: "Europe/Prague", startLocal: "2026-09-10T11:00:00.000", endLocal: "2026-09-10T12:00:00.000" }, recurrence: null },
      { timeModel: null, recurrence: "RRULE:FREQ=DAILY" },
    ]) {
      await db.update(events).set(unsupported).where(eq(events.id, event.id));
      await assert.rejects(queueProviderReminderEdit(owner, event.id, { ...request, operationID: randomUUID() }), /unsupported/);
    }
    await db.update(events).set({ timeModel: null, recurrence: null }).where(eq(events.id, event.id));
    const competing = await Promise.allSettled([
      queueProviderReminderEdit(owner, event.id, {
        ...request,
        operationID: randomUUID(),
      }),
      queueProviderReminderEdit(owner, event.id, {
        ...request,
        operationID: randomUUID(),
      }),
    ]);
    assert.deepEqual(competing.map((result) => result.status).sort(), [
      "fulfilled",
      "rejected",
    ]);
    assert.equal(
      (
        await db
          .select()
          .from(eventOutbox)
          .where(eq(eventOutbox.eventID, event.id))
      ).length,
      1,
    );
    // A transaction timestamp may predate its predecessor. Preserve actual
    // operation order at equal revisions, including the next canonical write.
    await db.delete(eventOutbox).where(eq(eventOutbox.eventID, event.id));
    const predecessorID = randomUUID();
    await db
      .insert(eventOutbox)
      .values({
        ...rows[0],
        id: predecessorID,
        mutationID: randomUUID(),
        status: "completed",
        createdAt: new Date("2090-01-01T00:00:00Z"),
      });
    const later = await queueProviderReminderEdit(owner, event.id, {
      ...request,
      operationID: randomUUID(),
    });
    const ordered = await db.execute(
      sql`select b.created_at > a.created_at as ordered from event_outbox a, event_outbox b where a.id = ${predecessorID} and b.id = ${later.operationID}`,
    );
    assert.equal(ordered.rows[0].ordered, true);
    const contentID = randomUUID();
    await db.transaction((tx) =>
      appendEventOutbox(tx, { ...event, revision: event.revision! + 1 }, [
        {
          ...rows[0],
          id: contentID,
          mutationID: randomUUID(),
          payload: { event },
        },
      ]),
    );
    const [content] = await db
      .select()
      .from(eventOutbox)
      .where(eq(eventOutbox.id, contentID));
    assert.equal(
      content.predecessorID,
      later.operationID,
      "canonical edit must wait for the latest personal operation",
    );
    assert.equal(await claimEventOutbox(contentID), undefined);
    await db
      .delete(calendarMembers)
      .where(
        and(
          eq(calendarMembers.calendarID, calendar.id),
          eq(calendarMembers.userID, owner),
        ),
      );
    await assert.rejects(
      queueProviderReminderEdit(owner, event.id, request),
      /connected source account/,
    );
  } finally {
    for (const id of [owner, other])
      await db.delete(user).where(eq(user.id, id));
  }
  console.log(
    "Native reminder intent: private source, strict CAS, concurrent replay, unchanged event and fail-closed worker: OK",
  );
}
main().finally(() => db.$client.end());
