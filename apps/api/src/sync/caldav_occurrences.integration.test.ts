import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, events, eventOutbox, externalEvents, importExternalCalendar, replaceExternalEventResource, user } from "@musubi/db";
import { normalizeCaldavResource } from "./adapters/caldav_time";
import { EventSchema } from "@musubi/types";
import { expandRecurringEvents } from "@musubi/calendar";

async function main() {
  assert.equal(process.env.ENVIRONMENT, "test");
  const userID = `caldav-occurrence-${randomUUID()}`;
  await db.insert(user).values({ id: userID, name: "Fixture", email: `${userID}@example.test` });
  try {
    const calendar = await importExternalCalendar("caldav", userID, "fixture", "Fixture", { externalId: "calendar", name: "Fixture", color: "#7A8BA3" });
    const component = (...lines: string[]) => ["BEGIN:VEVENT", "UID:family", ...lines, "END:VEVENT"].join("\r\n");
    const master = component("DTSTART;TZID=Europe/Prague:20260328T090000", "DTEND;TZID=Europe/Prague:20260328T100000", "RRULE:FREQ=DAILY;COUNT=4", "SUMMARY:Master");
    const moved = component("RECURRENCE-ID;TZID=Europe/Prague:20260329T090000", "DTSTART;TZID=Europe/Prague:20260329T140000", "DTEND;TZID=Europe/Prague:20260329T160000", "SUMMARY:Moved");
    const cancelled = component("RECURRENCE-ID;TZID=Europe/Prague:20260330T090000", "DTSTART;TZID=Europe/Prague:20260330T090000", "DURATION:PT1H", "STATUS:CANCELLED");
    const persist = (etag: string, ...components: string[]) => {
      const input = { url: "https://dav.example.test/calendar/family.ics", etag, data: ["BEGIN:VCALENDAR", "VERSION:2.0", ...components, "END:VCALENDAR"].join("\r\n") };
      const observations = normalizeCaldavResource(input).map(event => ({ externalId: event.externalId, etag, icalUid: event.icalUid!, values: { title: event.title, start: event.start, end: event.end, color: "#7A8BA3", isAllDay: event.isAllDay, description: event.description, location: event.location, organizer: event.organizer ?? "", recurrence: event.recurrence, url: event.url }, time: { timeModel: event.timeModel!, externalSeriesID: event.externalSeriesID, originalStart: event.originalStart, isCanceled: event.isCanceled } }));
      return replaceExternalEventResource("caldav", userID, calendar.id, "calendar", input.url, observations);
    };
    const rows = () => db.select().from(events).where(eq(events.creatorID, userID)).orderBy(events.id);
    const expand = async () => expandRecurringEvents((await rows()).filter(event => !event.deletedAt).map(event => ({ ...event, calendars: [calendar.id] })), new Date("2026-03-28T00:00Z"), new Date("2026-04-01T00:00Z"), { consumerTimeZone: "America/New_York" });
    assert.equal(await persist('"v1"', moved, master, cancelled), true);
    const initial = await rows();
    assert.equal(initial.length, 3);
    assert.equal((await expand()).length, 3);
    assert.equal(await persist('"v1"', master, moved, cancelled), false);
    assert.deepEqual(await rows(), initial);
    assert.equal(await persist('"v2"', master, cancelled), true);
    assert.equal((await rows()).find(event => event.title === "Moved")!.deletedAt instanceof Date, true);
    assert.equal((await expand()).find(event => event.start.toISOString() === "2026-03-29T07:00:00.000Z")!.title, "Master");
    assert.equal(await persist('"v3"', cancelled, moved, master), true);
    assert.deepEqual((await rows()).map(event => event.id), initial.map(event => event.id), "Revival reuses logical IDs");
    const beforeFailure = await rows();
    const mappings = await db.select().from(externalEvents).where(eq(externalEvents.calendarID, calendar.id)).orderBy(externalEvents.id);
    await assert.rejects(persist('"v4"', master.replace("SUMMARY:Master", "SUMMARY:Must rollback"), moved.replace("RECURRENCE-ID;TZID=Europe/Prague:20260329T090000", "RECURRENCE-ID;VALUE=DATE:20260329")), /resource could not be persisted/);
    assert.deepEqual(await rows(), beforeFailure);
    assert.deepEqual(await db.select().from(externalEvents).where(eq(externalEvents.calendarID, calendar.id)).orderBy(externalEvents.id), mappings, "Failed resource must not accept any component ETag");
    for (const target of beforeFailure.filter(event => event.title === "Master" || event.title === "Moved")) {
      const id = randomUUID();
      await db.insert(eventOutbox).values({ id, actorID: userID, mutationID: randomUUID(), position: 0, eventID: target.id, revision: target.revision, calendarID: calendar.id, externalCalendarLinkID: randomUUID(), provider: "caldav", userID, accountID: "fixture", externalCalendarID: "calendar", action: "update", payload: { event: EventSchema.parse({ ...target, calendars: [calendar.id] }), patch: { title: "Pending" } } });
      try {
        await assert.rejects(persist('"pending"', master.replace("SUMMARY:Master", "SUMMARY:Must rollback"), cancelled), /resource could not be persisted/);
        assert.deepEqual(await rows(), beforeFailure, "Pending master or omitted child rejects the whole resource");
        assert.deepEqual(await db.select().from(externalEvents).where(eq(externalEvents.calendarID, calendar.id)).orderBy(externalEvents.id), mappings);
      } finally { await db.delete(eventOutbox).where(eq(eventOutbox.id, id)); }
    }
    await persist('"v5"', master.replace("RRULE:FREQ=DAILY;COUNT=4\r\n", ""));
    assert.equal((await rows()).filter(event => !event.deletedAt).length, 1, "Removing recurrence and all overrides is atomic");
  } finally { await db.delete(user).where(eq(user.id, userID)); }
  console.log("CalDAV resource replacement, omitted overrides, revival and rollback: OK");
}
main().finally(() => db.$client.end());
