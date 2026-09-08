import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import express from "express";
import { eq } from "drizzle-orm";
import { config } from "@musubi/config";
import { EventSchema, CLIENT_VERSION_HEADER, PRODUCT_VERSION } from "@musubi/types";
import { createCalendar, createEvent, db, calendarMembers, externalCalendars, getEventSnapshot, replaceMemberToken, user } from "@musubi/db";
import { issueMemberToken } from "../federation_tokens";
import { requireAuth } from "../middleware/require_auth";
import { middlewareErrorHandler } from "../middleware/error_handler";
import { handlerEditEventTime, handlerGetEvents, handlerForkEvent, handlerUpdateEvent } from "./events";

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
    const saved = await send({ expectedRevision: 1, time });
    assert.equal(saved.status, 200);
    const parsed = EventSchema.parse(saved.body);
    assert.equal(parsed.revision, 2);
    assert.equal(parsed.start.toISOString(), "2026-03-29T01:30:00.000Z");
    assert.equal(parsed.timeModel?.kind === "zoned" && parsed.timeModel.startLocal, "2026-03-29T02:30:00.000");
    const read = await send(undefined, token.raw, "/events", "GET");
    assert.deepEqual(EventSchema.parse(read.body.events.find((row: { id: string }) => row.id === event.id)).timeModel, parsed.timeModel);
    assert.equal((await send({ expectedRevision: 1, time })).status, 409);
    assert.equal((await send({ expectedRevision: 2, time })).body.revision, 2);
    assert.equal((await send({ id: event.id, expectedRevision: 2, patch: { timeModel: { kind: "all-day" } } }, token.raw, "/events", "PATCH")).status, 400);
    const fork = await send({ calendarID: copy.id, expectedRevision: 2 }, token.raw, `/events/${event.id}/fork`, "POST");
    assert.equal(fork.status, 400);
    assert.match(fork.body.error, /time-model-aware copy/);
    const before = await getEventSnapshot(event.id);
    assert.equal((await send({ expectedRevision: 2, time: { ...time, endLocal: "2026-03-29T03:00:00" } })).status, 400);
    assert.deepEqual(await getEventSnapshot(event.id), before);

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
    try { failed = await send({ expectedRevision: 2, time: { kind: "floating", startLocal: "2026-03-30T09:00:00", endLocal: "2026-03-30T10:00:00" } }); }
    finally { db.$client.query = query; }
    assert.equal(notificationFailed, true);
    assert.equal(failed.status, 502);
    assert.equal(failed.body.localCommitted, true);
    assert.equal(failed.body.committed[0].revision, 3);
    assert.equal(failed.body.committed[0].timeModel.kind, "floating");
    await db.insert(externalCalendars).values({ provider: "google", userID: owner, accountID: owner, externalCalendarID: "remote", calendarID: calendar.id });
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
