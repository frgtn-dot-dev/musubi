import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import express from "express";
import { eq } from "drizzle-orm";
import { resolveEventTimeEdit } from "@musubi/calendar";
import { config } from "@musubi/config";
import { CLIENT_VERSION_HEADER, PRODUCT_VERSION, EventScopeOutcomeSchema } from "@musubi/types";
import { createCalendar, createEvent, db, calendarMembers, getEventSnapshot, replaceMemberToken, user } from "@musubi/db";
import { issueMemberToken } from "../federation_tokens";
import { requireAuth } from "../middleware/require_auth";
import { middlewareErrorHandler } from "../middleware/error_handler";
import { handlerEventScope } from "./events";

async function main() {
  assert.equal(process.env.ENVIRONMENT, "test");
  const owner = `scope-api-${randomUUID()}`;
  const viewer = `scope-viewer-${randomUUID()}`;
  const token = issueMemberToken();
  const viewerToken = issueMemberToken();
  for (const [id, credential] of [[owner, token], [viewer, viewerToken]] as const) {
    await db.insert(user).values({ id, name: id, email: `${id}@example.test`, isExternal: true });
    await replaceMemberToken(id, credential.tokenHash);
  }
  const calendar = await createCalendar({ creatorID: owner, name: "Local", color: "red" });
  await db.insert(calendarMembers).values({ calendarID: calendar.id, userID: viewer, role: "viewer" });
  const event = await createEvent({ id: randomUUID(), creatorID: owner, organizer: owner, title: "Daily", color: "red", recurrence: "RRULE:FREQ=DAILY;COUNT=4", ...resolveEventTimeEdit({ kind: "zoned", timeZone: "Europe/Prague", startLocal: "2026-03-28T09:00:00", endLocal: "2026-03-28T10:00:00" }) }, [calendar.id]);
  const app = express();
  app.use(express.json());
  app.post("/events/:eventId/scope", requireAuth, handlerEventScope);
  app.use(middlewareErrorHandler);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const send = async (body: unknown, credential: string | null = token.raw) => {
    const response = await fetch(`${origin}/events/${event.id}/scope`, { method: "POST", headers: { ...(credential ? { authorization: `Bearer ${credential}` } : {}), "content-type": "application/json", [CLIENT_VERSION_HEADER]: PRODUCT_VERSION }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  const enabled = config.api.eventTimeEditsEnabled;
  const request = { operationID: randomUUID(), expectedRevision: 1, scope: "occurrence", action: "delete", originalStart: { kind: "instant", value: "2026-03-29T07:00:00.000Z" }, expectedOccurrenceRevision: null };
  try {
    config.api.eventTimeEditsEnabled = false;
    assert.equal((await send(request)).status, 403);
    config.api.eventTimeEditsEnabled = true;
    assert.equal((await send(request, null)).status, 401);
    assert.equal((await send(request, viewerToken.raw)).status, 403);
    assert.equal((await send({ ...request, calendars: [] })).status, 400);
    assert.equal((await send({ ...request, originalStart: { kind: "instant", value: "2027-03-29T07:00:00.000Z" } })).status, 400);
    const saved = await send(request);
    assert.equal(saved.status, 200);
    const { localCommitted, replayed, ...outcome } = saved.body;
    assert.equal(localCommitted, true);
    assert.equal(replayed, false);
    assert.equal(EventScopeOutcomeSchema.parse(outcome).events.length, 2);
    const replay = await send(request);
    assert.equal(replay.status, 200);
    assert.equal(replay.body.replayed, true);
    assert.deepEqual(replay.body.events, saved.body.events);
    assert.equal((await getEventSnapshot(event.id))!.revision, 2);
    assert.equal((await send({ ...request, action: "update", patch: { title: "Bad reuse" } })).status, 400);
    const conflict = await send({ ...request, operationID: randomUUID() });
    assert.equal(conflict.status, 409);
    assert.equal(conflict.body.localCommitted, false);
    assert.equal(conflict.body.currentRevision, 2);
    const removal = { operationID: randomUUID(), expectedRevision: 2, action: "delete", scope: "series" };
    assert.equal((await send(removal)).status, 200);
    assert.equal((await send(removal)).body.replayed, true);
  } finally {
    config.api.eventTimeEditsEnabled = enabled;
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    for (const id of [owner, viewer]) await db.delete(user).where(eq(user.id, id));
  }
  console.log("Authenticated scope HTTP: gate/auth, strict intent, CAS, cancellation and durable retry: OK");
}
main().finally(() => db.$client.end());
