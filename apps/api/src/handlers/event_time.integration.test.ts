import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import express from "express";
import { expandRecurringEvents, editEventTimeDraft, knownEventTimeDraft, seriesEditWrites, withSeriesEditIntent } from "@musubi/calendar";
import { eq } from "drizzle-orm";
import { config } from "@musubi/config";
import { eventUpdateOperation, EventSchema, CLIENT_VERSION_HEADER, PRODUCT_VERSION } from "@musubi/types";
import { createCalendar, createEvent, db, calendarMembers, externalCalendars, getEventSnapshot, replaceMemberToken, user } from "@musubi/db";
import { issueMemberToken } from "../federation_tokens";
import { requireAuth } from "../middleware/require_auth";
import { middlewareErrorHandler } from "../middleware/error_handler";
import { handlerCreateEventTime, handlerEditEventTime, handlerGetEvents, handlerForkEvent, handlerUpdateEvent } from "./events";

async function main() {
  assert.equal(process.env.ENVIRONMENT, "test");
  const owner = `time-api-${randomUUID()}`;
  const viewer = `time-viewer-${randomUUID()}`;
  const token = issueMemberToken();
  const viewerToken = issueMemberToken();
  for (const [id, credential] of [[owner, token], [viewer, viewerToken]] as const) {
    await db.insert(user).values({ id, name: id, email: `${id}@example.test`, isExternal: true });
    await replaceMemberToken(id, credential.tokenHash);
  }
  const calendar = await createCalendar({ creatorID: owner, name: "Local", color: "red" });
  const copy = await createCalendar({ creatorID: owner, name: "Copy", color: "blue" });
  await db.insert(calendarMembers).values({ calendarID: calendar.id, userID: viewer, role: "viewer" });
  const event = await createEvent({ id: randomUUID(), creatorID: owner, organizer: owner, title: "Keep title", color: "red", start: new Date("2026-03-28T09:00:00Z"), end: new Date("2026-03-28T10:00:00Z") }, [calendar.id]);
  const app = express();
  app.use(express.json());
  app.post("/events/time", requireAuth, handlerCreateEventTime);
  app.put("/events/:eventId/time", requireAuth, handlerEditEventTime);
  app.get("/events", requireAuth, handlerGetEvents);
  app.patch("/events", requireAuth, handlerUpdateEvent);
  app.post("/events/:eventId/fork", requireAuth, handlerForkEvent);
  app.use(middlewareErrorHandler);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const send = async (body: unknown, credential: string | null = token.raw, path = `/events/${event.id}/time`, method = "PUT") => {
    const response = await fetch(origin + path, { method, headers: { ...(credential ? { authorization: `Bearer ${credential}` } : {}), "content-type": "application/json", [CLIENT_VERSION_HEADER]: PRODUCT_VERSION }, body: method === "GET" ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  const enabled = config.api.eventTimeEditsEnabled;
  const time = { kind: "zoned", timeZone: "Europe/Prague", startLocal: "2026-03-29T02:30:00", endLocal: "2026-03-29T04:30:00" };
  try {
    config.api.eventTimeEditsEnabled = false;
    assert.equal((await send({ expectedRevision: 1, time })).status, 403);
    assert.equal((await getEventSnapshot(event.id))?.revision, 1);
    config.api.eventTimeEditsEnabled = true;
    assert.equal((await send({ expectedRevision: 1, time }, null)).status, 401);
    assert.equal((await send({ expectedRevision: 1, time }, viewerToken.raw)).status, 403);
    assert.equal((await send({ expectedRevision: 1, time, seriesID: randomUUID() })).status, 400);
    for (const field of ["calendars", "organizer", "hasAttendees", "isCanceled", "timeModel", "start"]) {
      assert.equal((await send({ expectedRevision: 1, time, patch: { [field]: null } })).status, 400);
    }
    const saved = await send({ expectedRevision: 1, time, patch: { title: "Atomic draft", description: null } });
    assert.equal(saved.status, 200);
    const parsed = EventSchema.parse(saved.body);
    assert.equal(parsed.revision, 2);
    assert.equal(parsed.title, "Atomic draft");
    assert.equal(parsed.description, null);
    assert.equal(parsed.start.toISOString(), "2026-03-29T01:30:00.000Z");
    assert.equal(parsed.timeModel?.kind === "zoned" && parsed.timeModel.startLocal, "2026-03-29T02:30:00.000");
    const read = await send(undefined, token.raw, "/events", "GET");
    assert.deepEqual(EventSchema.parse(read.body.events.find((row: { id: string }) => row.id === event.id)).timeModel, parsed.timeModel);
    assert.equal((await send({ expectedRevision: 1, time })).status, 409);
    assert.equal((await send({ expectedRevision: 2, time })).body.revision, 2);
    assert.equal((await send({ id: event.id, expectedRevision: 2, patch: { timeModel: { kind: "all-day" } } }, token.raw, "/events", "PATCH")).status, 400);
    const fork = await send({ calendarID: copy.id, expectedRevision: 2 }, token.raw, `/events/${event.id}/fork`, "POST");
    assert.equal(fork.status, 201, JSON.stringify(fork.body));
    assert.deepEqual(fork.body.timeModel, saved.body.timeModel);
    assert.equal(fork.body.start, saved.body.start);
    assert.equal(fork.body.revision, 1);
    assert.notEqual(fork.body.id, event.id);
    assert.deepEqual(fork.body.calendars, [copy.id]);
    assert.equal((await send({ calendarID: copy.id, expectedRevision: 1 }, token.raw, `/events/${event.id}/fork`, "POST")).status, 409);
    config.api.eventTimeEditsEnabled = false;
    assert.equal((await send({ calendarID: copy.id, expectedRevision: 2 }, token.raw, `/events/${event.id}/fork`, "POST")).status, 403);
    config.api.eventTimeEditsEnabled = true;

    for (const intent of [time, { kind: "floating", startLocal: "2026-03-29T09:00:00", endLocal: "2026-03-29T10:00:00" }, { kind: "all-day", startDate: "2026-03-29", endDate: "2026-03-30" }]) {
      const content = { id: randomUUID(), creatorID: "untrusted", organizer: "untrusted", title: "New civil series", color: "red", calendars: [calendar.id], isCanceled: false, hasAttendees: false, recurrence: "FREQ=DAILY;COUNT=3" };
      const request = { event: content, time: intent };
      config.api.eventTimeEditsEnabled = false;
      assert.equal((await send(request, token.raw, "/events/time", "POST")).status, 403);
      config.api.eventTimeEditsEnabled = true;
      assert.equal((await send(request, viewerToken.raw, "/events/time", "POST")).status, 403);
      assert.equal(await getEventSnapshot(content.id), undefined);
      assert.equal((await send({ ...request, event: { ...content, timeModel: { kind: "all-day" } } }, token.raw, "/events/time", "POST")).status, 400);
      const created = await send(request, token.raw, "/events/time", "POST");
      assert.equal(created.status, 201, JSON.stringify(created.body));
      assert.equal(created.body.timeModel.kind, intent.kind);
      assert.equal(created.body.creatorID, owner);
      assert.equal(created.body.organizer, owner);
      assert.equal(created.body.revision, 1);
      const cloned = await send({ calendarID: copy.id, expectedRevision: 1 }, token.raw, `/events/${content.id}/fork`, "POST");
      assert.equal(cloned.status, 201);
      assert.deepEqual(cloned.body.timeModel, created.body.timeModel);
      assert.equal(cloned.body.start, created.body.start);
      assert.equal(cloned.body.end, created.body.end);
      assert.equal(cloned.body.recurrence, content.recurrence);
    }
    const folded = await createEvent({ id: randomUUID(), creatorID: owner, organizer: owner, title: "Second fold", color: "red", start: new Date("2026-10-25T01:30:00Z"), end: new Date("2026-10-25T02:30:00Z"), timeModel: { kind: "zoned", timeZone: "Europe/Prague", startLocal: "2026-10-25T02:30:00.000", endLocal: "2026-10-25T03:30:00.000" } }, [calendar.id]);
    const foldCopy = await send({ calendarID: copy.id, expectedRevision: 1 }, token.raw, `/events/${folded.id}/fork`, "POST");
    assert.equal(foldCopy.status, 201);
    assert.equal(foldCopy.body.start, "2026-10-25T01:30:00.000Z");
    assert.deepEqual(foldCopy.body.timeModel, folded.timeModel);
    const deniedRequest = { event: { id: randomUUID(), creatorID: owner, organizer: owner, title: "Rejected", color: "red", calendars: [calendar.id], isCanceled: false, recurrence: "FREQ=HOURLY;COUNT=2" }, time };
    assert.equal((await send(deniedRequest, token.raw, "/events/time", "POST")).status, 400);
    assert.equal(await getEventSnapshot(deniedRequest.event.id), undefined);
    const detached = await createEvent({ id: randomUUID(), creatorID: owner, organizer: owner, title: "Detached", color: "red", start: folded.start, end: folded.end, timeModel: folded.timeModel, seriesID: folded.id, originalStart: { kind: "instant", value: folded.start.toISOString() } }, [calendar.id]);
    assert.equal((await send({ calendarID: copy.id, expectedRevision: 1 }, token.raw, `/events/${folded.id}/fork`, "POST")).status, 400);
    assert.equal((await send({ calendarID: copy.id, expectedRevision: 1 }, token.raw, `/events/${detached.id}/fork`, "POST")).status, 400);
    const before = await getEventSnapshot(event.id);
    assert.equal((await send({ expectedRevision: 2, time: { ...time, endLocal: "2026-03-29T03:00:00" } })).status, 400);
    assert.deepEqual(await getEventSnapshot(event.id), before);

    assert.equal((await send({ expectedRevision: 2, time, patch: { title: "Invalid draft", recurrence: "FREQ=HOURLY;COUNT=2" } })).status, 400);
    assert.deepEqual(await getEventSnapshot(event.id), before);

    // Real authenticated CAS for the planner's whole-series civil shift.
    const series = await createEvent({ id: randomUUID(), creatorID: owner, organizer: owner, title: "Civil series", color: "red", start: new Date("2026-03-28T08:30:17.123Z"), end: new Date("2026-03-28T09:30:19.456Z"), recurrence: "FREQ=DAILY;COUNT=4" }, [calendar.id]);
    const adopted = await send({ expectedRevision: 1, time: { kind: "zoned", timeZone: "Europe/Prague", startLocal: "2026-03-28T09:30:17.123", endLocal: "2026-03-28T10:30:19.456" } }, token.raw, `/events/${series.id}/time`);
    assert.equal(adopted.status, 200);
    const master = EventSchema.parse(adopted.body);
    const occurrence = expandRecurringEvents([master], new Date("2026-03-29T00:00Z"), new Date("2026-03-30T00:00Z"), { consumerTimeZone: "America/New_York" })[0]!;
    const draft = editEventTimeDraft(occurrence, { ...occurrence, title: "Shifted together" }, { ...knownEventTimeDraft(occurrence)!, date: "2026-03-30", endDate: "2026-03-30" });
    const operation = eventUpdateOperation(withSeriesEditIntent(seriesEditWrites({ master, occurrence, edited: draft, scope: "series" })).updates[0]!);
    const shifted = await send(operation.body, token.raw, operation.path);
    assert.equal(shifted.status, 200);
    assert.equal(shifted.body.start, "2026-03-29T07:30:17.123Z");
    assert.equal(shifted.body.title, "Shifted together");
    assert.equal(shifted.body.recurrence, master.recurrence);
    assert.equal(shifted.body.revision, 3);
    const committed = await getEventSnapshot(master.id);
    assert.equal((await send(operation.body, token.raw, operation.path)).status, 409);
    assert.deepEqual(await getEventSnapshot(master.id), committed);

    // Notification failure after commit must retain an honest committed receipt.
    const query = db.$client.query.bind(db.$client);
    let notificationFailed = false;
    (db.$client as any).query = async (statement: any, ...args: any[]) => {
      const text = typeof statement === "string" ? statement : statement.text;
      if (text.includes('from "calendar_members"')) {
        const rows = await query('select revision from events where id = $1', [event.id]);
        if (rows.rows[0]?.revision === 3) { notificationFailed = true; throw new Error("injected notification failure"); }
      }
      return (query as any)(statement, ...args);
    };
    let failed;
    try { failed = await send({ expectedRevision: 2, time: { kind: "floating", startLocal: "2026-03-30T09:00:00", endLocal: "2026-03-30T10:00:00" }, patch: { title: "Committed together" } }); }
    finally { db.$client.query = query; }
    assert.equal(notificationFailed, true);
    assert.equal(failed.status, 502);
    assert.equal(failed.body.localCommitted, true);
    assert.equal(failed.body.committed[0].revision, 3);
    assert.equal(failed.body.committed[0].title, "Committed together");
    assert.equal(failed.body.committed[0].timeModel.kind, "floating");
    await db.insert(externalCalendars).values({ provider: "google", userID: owner, accountID: owner, externalCalendarID: "remote", calendarID: calendar.id });
    for (const recurrence of [null, "FREQ=DAILY;COUNT=4"]) {
      const externalCreate = { event: { ...deniedRequest.event, recurrence }, time };
      const externalRejected = await send(externalCreate, token.raw, "/events/time", "POST");
      assert.equal(externalRejected.status, 403);
      assert.equal(externalRejected.body.reason, "unsupported");
      assert.equal(externalRejected.body.capability, "event-write");
      assert.match(externalRejected.body.error, /not supported for this calendar\. No changes were saved\./);
      assert.equal(await getEventSnapshot(deniedRequest.event.id), undefined);
    }
    assert.equal((await send({ calendarID: copy.id, expectedRevision: 3 }, token.raw, `/events/${event.id}/fork`, "POST")).status, 403);
    assert.equal((await send({ expectedRevision: 3, time })).status, 400);
    assert.equal((await getEventSnapshot(event.id))?.revision, 3);
  } finally {
    config.api.eventTimeEditsEnabled = enabled;
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await db.delete(user).where(eq(user.id, viewer));
    await db.delete(user).where(eq(user.id, owner));
  }
  console.log("Authorized local time API/read metadata integration: OK");
}
main().finally(() => db.$client.end());
