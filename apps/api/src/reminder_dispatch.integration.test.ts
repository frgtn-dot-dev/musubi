import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { resolveReminders } from "@musubi/calendar";
import { occurrenceKey } from "@musubi/types";
import {
  db,
  user,
  events,
  calendarEvents,
  createCalendar,
  getRemindersDocument,
  setEventReminder,
} from "@musubi/db";
import { reminderEventsFor } from "./reminder_dispatch";

async function main() {
  assert.equal(process.env.ENVIRONMENT, "test");
  const userID = `reminder-time-${randomUUID()}`;
  await db
    .insert(user)
    .values({ id: userID, name: userID, email: `${userID}@example.test` });
  try {
    const home = await createCalendar({
      creatorID: userID,
      name: "Home",
      color: "red",
    });
    const copy = await createCalendar({
      creatorID: userID,
      name: "Copy",
      color: "red",
    });
    const base = {
      creatorID: userID,
      organizer: userID,
      originCalendarID: home.id,
      title: "Series",
      color: "red",
      isAllDay: false,
      start: new Date("2026-03-28T08:00:00Z"),
      end: new Date("2026-03-28T09:00:00Z"),
      recurrence: "FREQ=DAILY;COUNT=3",
    };
    const [master] = await db
      .insert(events)
      .values({
        ...base,
        id: randomUUID(),
        timeModel: {
          kind: "zoned",
          timeZone: "Europe/Prague",
          startLocal: "2026-03-28T09:00:00.000",
          endLocal: "2026-03-28T10:00:00.000",
        },
      })
      .returning();
    const originalStart = {
      kind: "instant" as const,
      value: "2026-03-29T07:00:00.000Z",
    };
    const [exception] = await db
      .insert(events)
      .values({
        ...base,
        id: randomUUID(),
        recurrence: null,
        seriesID: master.id,
        originalStart,
        start: new Date("2026-03-29T07:00:00Z"),
        end: new Date("2026-03-29T08:00:00Z"),
        timeModel: {
          kind: "zoned",
          timeZone: "Europe/Prague",
          startLocal: "2026-03-29T09:00:00.000",
          endLocal: "2026-03-29T10:00:00.000",
        },
      })
      .returning();
    await db
      .insert(calendarEvents)
      .values(
        [master, exception].flatMap((event) =>
          [home, copy].map((calendar) => ({
            eventID: event.id,
            calendarID: calendar.id,
          })),
        ),
      );
    await setEventReminder(userID, master.id, {
      minutesBefore: 30,
      allDay: null,
    });
    const from = new Date("2026-03-29T06:29:00Z"),
      to = new Date("2026-03-29T06:31:00Z");
    const document = await getRemindersDocument(userID);
    const resolve = async () =>
      resolveReminders({
        context: {
          timezone: "America/New_York",
          calendarOrder: [home.id, copy.id],
          calendarRules: document.calendars,
          eventRules: document.events,
          defaultRule: document.default,
        },
        events: await reminderEventsFor(
          userID,
          from,
          new Date(to.getTime() + 31 * 86400000),
        ),
        from,
        to,
      });
    const projected = await reminderEventsFor(
      userID,
      from,
      new Date("2026-04-30T00:00:00Z"),
    );
    assert.equal(
      projected.length,
      2,
      "calendar membership joins must not duplicate definitions",
    );
    const projectedException = projected.find(
      (event) => event.id === exception.id,
    )!;
    assert.deepEqual(projectedException.originalStart, originalStart);
    assert.equal(projectedException.seriesID, master.id);
    assert.deepEqual(projectedException.timeModel, exception.timeModel);
    assert.deepEqual(
      [...projectedException.calendars].sort(),
      [home.id, copy.id].sort(),
    );
    const due = await resolve();
    assert.equal(
      due.length,
      1,
      "exception inherits parent override across DST",
    );
    assert.equal(due[0].eventID, exception.id);
    assert.equal(
      due[0].occurrenceID,
      occurrenceKey({ seriesId: master.id, originalStart }),
    );
    assert.equal(due[0].dueAt.toISOString(), "2026-03-29T06:30:00.000Z");
    await db
      .update(events)
      .set({ isCanceled: true })
      .where(eq(events.id, exception.id));
    assert.deepEqual(
      await resolve(),
      [],
      "canceled exception suppresses the original reminder",
    );
    await db
      .update(events)
      .set({
        isCanceled: false,
        start: new Date("2026-06-01T07:00:00Z"),
        end: new Date("2026-06-01T08:00:00Z"),
        timeModel: {
          kind: "zoned",
          timeZone: "Europe/Prague",
          startLocal: "2026-06-01T09:00:00.000",
          endLocal: "2026-06-01T10:00:00.000",
        },
      })
      .where(eq(events.id, exception.id));
    assert.deepEqual(
      await resolve(),
      [],
      "moved-out exception still suppresses its original slot",
    );
    assert.deepEqual(
      await reminderEventsFor(`other-${randomUUID()}`, from, to),
      [],
      "membership scope remains enforced",
    );
  } finally {
    await db.delete(user).where(eq(user.id, userID));
  }
  console.log(
    "Server reminder DB projection and original occurrence resolution: OK",
  );
}
main().finally(() => db.$client.end());
