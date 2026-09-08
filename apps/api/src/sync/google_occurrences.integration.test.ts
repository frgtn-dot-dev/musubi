import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { eq } from "drizzle-orm";
import { config } from "@musubi/config";
import { account, db, events, externalEvents, calendarEvents, eventOutbox, importExternalCalendar, upsertExternalEvent, getUsersEvents, getUserExternalCalendars, user } from "@musubi/db";
import { EventSchema } from "@musubi/types";
import { expandRecurringEvents } from "@musubi/calendar";
import { googleAdapter } from "./adapters/google";
import { syncProvider } from "./engine";

async function main() {
  assert.equal(process.env.ENVIRONMENT, "test");
  const userID = `google-occurrence-${randomUUID()}`;
  const master = { id: "series", etag: '"master-1"', summary: "Morning", start: { dateTime: "2026-03-28T09:00:00+01:00", timeZone: "Europe/Prague" }, end: { dateTime: "2026-03-28T10:00:00+01:00", timeZone: "Europe/Prague" }, recurrence: ["RRULE:FREQ=DAILY;COUNT=4"] };
  const moved = { id: "moved", etag: '"move-1"', recurringEventId: "series", originalStartTime: { dateTime: "2026-03-29T09:00:00+02:00" }, summary: "Long moved meeting", start: { dateTime: "2026-03-29T14:00:00+02:00" }, end: { dateTime: "2026-03-29T16:00:00+02:00" } };
  const cancelled = { id: "cancelled", etag: '"cancel-1"', recurringEventId: "series", originalStartTime: { dateTime: "2026-03-30T09:00:00+02:00" }, status: "cancelled" };
  let items: any[] = [moved, cancelled, master];
  let failMaster = false;
  let expire = false;
  let hydrated = 0;
  const fixture = createServer((req, res) => {
    const url = new URL(req.url!, "http://fixture.test");
    assert.equal(req.method, "GET");
    res.setHeader("content-type", "application/json");
    const json = (body: unknown) => res.end(JSON.stringify(body));
    if (url.pathname.endsWith("/users/me/calendarList")) return json({ items: [{ id: "calendar", summary: "Fixture", backgroundColor: "#7A8BA3", accessRole: "owner" }] });
    if (url.pathname.endsWith("/users/@me/lists")) return json({ items: [] });
    if (url.pathname.endsWith("/events/series")) {
      hydrated++;
      if (failMaster) { res.statusCode = 503; return json({ error: "temporary" }); }
      return json(master);
    }
    if (url.pathname.endsWith("/events")) {
      assert.equal(url.searchParams.get("showDeleted"), "true");
      if (expire && url.searchParams.has("syncToken")) { expire = false; res.statusCode = 410; return json({ error: "expired" }); }
      return json({ items, nextSyncToken: "cursor" });
    }
    res.statusCode = 500; json({ error: "Unexpected fixture route" });
  });
  await new Promise<void>(resolve => fixture.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(fixture.address() as { port: number }).port}`;
  const fetch = globalThis.fetch;
  const enabled = config.api.eventTimeEditsEnabled;
  globalThis.fetch = (input, init) => {
    const url = new URL(String(input));
    assert.ok(["www.googleapis.com", "tasks.googleapis.com"].includes(url.hostname));
    return fetch(origin + url.pathname + url.search, init);
  };
  config.api.eventTimeEditsEnabled = true;
  await db.insert(user).values({ id: userID, name: "Fixture", email: `${userID}@example.test` });
  try {
    await db.insert(account).values({ id: randomUUID(), userId: userID, providerId: "google", accountId: "account", scope: "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/tasks", refreshToken: "fixture", accessToken: "fixture", accessTokenExpiresAt: new Date(Date.now() + 3600000) });
    const source = await importExternalCalendar("google", userID, "account", "Fixture", { externalId: "calendar", name: "Fixture", color: "#7A8BA3" });
    await upsertExternalEvent("google", userID, source.id, "calendar", master.id, {
      title: master.summary, color: "#7A8BA3", start: new Date(master.start.dateTime), end: new Date(master.end.dateTime), isAllDay: false, description: null, location: null, organizer: "", recurrence: master.recurrence.join("\n"), url: null,
    }, master.etag);
    const [legacyMaster] = await db.select().from(events).where(eq(events.creatorID, userID));
    const destination = await importExternalCalendar("microsoft", userID, "other-account", "Other", { externalId: "other", name: "Other", color: "#7A8BA3" });
    await db.insert(calendarEvents).values({ calendarID: destination.id, eventID: legacyMaster.id });
    await db.insert(externalEvents).values({ provider: "microsoft", calendarID: destination.id, eventID: legacyMaster.id, externalCalendarID: "other", externalEventID: "other-master", etag: '"other-1"' });
    const sync = () => syncProvider(googleAdapter, userID, { id: "account", label: "Fixture" });
    const rows = () => db.select().from(events).where(eq(events.creatorID, userID)).orderBy(events.id);
    await sync();
    const before = await rows();
    assert.equal(before.length, 3);
    assert.deepEqual(await db.select().from(eventOutbox).where(eq(eventOutbox.eventID, legacyMaster.id)), [], "Time metadata adoption creates no outbound echo for existing linked copies");
    const localMaster = before.find(e => e.recurrence)!;
    assert.equal(before.filter(e => e.seriesID === localMaster.id).length, 2);
    assert.equal(before.find(e => e.isCanceled)?.deletedAt, null);
    const expanded = expandRecurringEvents([...new Map((await getUsersEvents(userID)).map(row => [row.event.id, EventSchema.parse({ ...row.event, calendars: [row.calendarID] })])).values()], new Date("2026-03-28T00:00Z"), new Date("2026-04-01T00:00Z"), { consumerTimeZone: "America/New_York" });
    assert.equal(expanded.length, 3);
    assert.ok(!expanded.some(e => e.start.toISOString() === "2026-03-29T07:00:00.000Z"));
    const exception = expanded.find(e => e.title === moved.summary)!;
    assert.equal(exception.end.getTime() - exception.start.getTime(), 7200000);
    items = [cancelled, moved];
    await sync();
    assert.equal(hydrated, 1);
    assert.deepEqual(await rows(), before, "Repeated hydration preserves UUIDs, revisions and cancellation");
    failMaster = true;
    const cursors = await getUserExternalCalendars("google", userID, "account");
    await assert.rejects(sync(), /hydration 503/);
    assert.deepEqual(await rows(), before);
    assert.deepEqual(await getUserExternalCalendars("google", userID, "account"), cursors);
    failMaster = false;
    expire = true;
    await sync();
    assert.deepEqual(await rows(), before, "Full reset keeps hydrated master and cancellation definitions");
    const validFamily = await rows();
    const beforeZoneCursor = await getUserExternalCalendars("google", userID, "account");
    items = [{ ...master, end: { ...master.end, timeZone: "Europe/Berlin" } }];
    await assert.rejects(sync(), /endpoint zones/);
    assert.deepEqual(await rows(), validFamily);
    assert.deepEqual(await getUserExternalCalendars("google", userID, "account"), beforeZoneCursor, "Unsupported endpoint zones cannot advance the import cursor");
    for (const broken of [
      { ...master, etag: '"not-recurring"', recurrence: undefined },
      { ...master, etag: '"changed-kind"', start: { date: "2026-03-28" }, end: { date: "2026-03-29" } },
    ]) {
      items = [broken];
      await assert.rejects(sync(), /observation could not be persisted/);
      assert.deepEqual(await rows(), validFamily, "A master-only delta cannot invalidate persisted exceptions");
    }
    items = [{ id: "series", status: "cancelled" }];
    await sync();
    assert.ok((await rows()).every(e => e.deletedAt), "Master deletion also tombstones its detached family");
    const maps = await db.select().from(externalEvents).where(eq(externalEvents.calendarID, cursors[0].calendarID));
    assert.equal(maps.length, 3, "Mappings survive for stable revival");
    items = [moved, master, cancelled];
    await sync();
    const revived = await rows();
    assert.ok(revived.every(e => !e.deletedAt));
    assert.deepEqual(revived.map(e => e.id), before.map(e => e.id));
    const revivedMaster = revived.find(e => e.id === localMaster.id)!;
    const deliveries = await db.select().from(eventOutbox).where(eq(eventOutbox.eventID, localMaster.id));
    assert.ok(deliveries.some(row => row.calendarID === destination.id && row.action === "create" && row.revision === revivedMaster.revision), "Identical revival still fans out to the derived destination");
    const dateMaster = { id: "dates", etag: '"dates-1"', summary: "Dates", start: { date: "2026-03-28" }, end: { date: "2026-03-29" }, recurrence: ["RRULE:FREQ=DAILY;COUNT=4"] };
    items = [{ id: "date-cancel", etag: '"date-cancel-1"', recurringEventId: "dates", originalStartTime: { date: "2026-03-29" }, status: "cancelled" }, dateMaster];
    await sync();
    const dateRows = (await rows()).filter(e => !e.deletedAt && e.timeModel?.kind === "all-day");
    assert.equal(dateRows.length, 2);
    assert.ok(dateRows.every(e => e.timeModel?.kind === "all-day" && e.isAllDay));
    const dates = expandRecurringEvents(dateRows.map(e => EventSchema.parse({ ...e, calendars: [cursors[0].calendarID] })), new Date("2026-03-28T00:00Z"), new Date("2026-04-01T00:00Z"), { consumerTimeZone: "America/New_York" });
    assert.deepEqual(dates.map(e => e.start.toISOString()), ["2026-03-28T00:00:00.000Z", "2026-03-30T00:00:00.000Z", "2026-03-31T00:00:00.000Z"]);
  } finally {
    globalThis.fetch = fetch;
    config.api.eventTimeEditsEnabled = enabled;
    fixture.closeAllConnections();
    await new Promise<void>(resolve => fixture.close(() => resolve()));
    await db.delete(user).where(eq(user.id, userID));
  }
  console.log("Google occurrence hydration, cancellation, reset and stable DB identity: OK");
}
main().finally(() => db.$client.end());
