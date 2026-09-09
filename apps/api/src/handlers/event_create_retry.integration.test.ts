import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import express from "express";
import { and, eq } from "drizzle-orm";
import { config } from "@musubi/config";
import { CLIENT_VERSION_HEADER, PRODUCT_VERSION, EventSchema } from "@musubi/types";
import { calendarEvents, calendarMembers, createCalendar, db, events, eventOutbox, externalCalendars, getEventSnapshot, replaceMemberToken, user } from "@musubi/db";
import { issueMemberToken } from "../federation_tokens";
import { requireAuth } from "../middleware/require_auth";
import { middlewareErrorHandler } from "../middleware/error_handler";
import { handlerCreateEvent, handlerCreateEventTime } from "./events";

async function main() {
  assert.equal(process.env.ENVIRONMENT, "test");
  const owner = `create-retry-${randomUUID()}`, other = `other-${randomUUID()}`, token = issueMemberToken(), otherToken = issueMemberToken();
  const flag = config.api.eventTimeEditsEnabled; config.api.eventTimeEditsEnabled = true;
  for (const [id, credential] of [[owner, token], [other, otherToken]] as const) {
    await db.insert(user).values({ id, name: "Fixture", email: `${id}@example.test`, isExternal: true }); await replaceMemberToken(id, credential.tokenHash);
  }
  const calendar = await createCalendar({ creatorID: owner, name: "Fixture", color: "red" });
  const app = express(); app.use(express.json()); app.post("/events", requireAuth, handlerCreateEvent); app.post("/events/time", requireAuth, handlerCreateEventTime); app.use(middlewareErrorHandler);
  const server = app.listen(0, "127.0.0.1"); await new Promise<void>(resolve => server.once("listening", resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const realFetch = globalThis.fetch; let providerRequests = 0;
  globalThis.fetch = (input, init) => { if (new URL(String(input)).origin !== origin) { providerRequests++; throw new Error("No provider delivery on receipt recovery"); } return realFetch(input, init); };
  const send = async (path: string, body: unknown, credential = token.raw, key?: string) => {
    const response = await realFetch(origin + path, { method: "POST", headers: { "content-type": "application/json", [CLIENT_VERSION_HEADER]: PRODUCT_VERSION, authorization: `Bearer ${credential}`, ...(key ? { "Idempotency-Key": key } : {}) }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json(), cache: response.headers.get("cache-control") };
  };
  const content = () => ({ id: randomUUID(), creatorID: owner, organizer: owner, title: "Retry", color: "red", calendars: [calendar.id], hasAttendees: false, isCanceled: false, recurrence: "RRULE:FREQ=DAILY;COUNT=4" });
  try {
    for (const kind of ["legacy", "zoned", "all-day"] as const) {
      const event = content(), path = kind === "legacy" ? "/events" : "/events/time";
      const request = kind === "legacy" ? { ...event, start: "2026-07-30T07:30:00Z", end: "2026-07-30T08:30:00Z", isAllDay: false } : { event, time: kind === "all-day" ? { kind, startDate: "2026-07-30", endDate: "2026-07-30" } : { kind, timeZone: "Europe/Prague", startLocal: "2026-07-30T09:30:00", endLocal: "2026-07-30T10:30:00" } };
      const [first, racing] = await Promise.all([send(path, request), send(path, request)]);
      assert.deepEqual([first.status, racing.status].sort(), [201, 202]);
      const baseline = EventSchema.parse(first.body);
      assert.deepEqual(EventSchema.parse(racing.body), baseline);
      const retry = await send(path, request); assert.equal(retry.status, 202); assert.equal(retry.body.localCommitted, true); assert.equal(retry.cache, "private, no-store"); assert.deepEqual(EventSchema.parse(retry.body), baseline);
      assert.equal((await send(path, request, token.raw, "invalid")).status, 400);
      assert.equal((await send(path, request, otherToken.raw)).status, 400);
      const changed = kind === "legacy" ? { ...request, title: "Different intent" } : { ...request, event: { ...event, title: "Different intent" } };
      assert.equal((await send(path, changed)).status, 409);
      await db.update(events).set({ title: "Later current title", revision: 2 }).where(eq(events.id, event.id));
      const current = await send(path, request); assert.equal(current.status, 409); assert.equal(current.body.localCommitted, true); assert.equal(current.body.current.title, "Later current title"); assert.equal(current.body.current.revision, 2);
      await db.update(events).set({ deletedAt: new Date() }).where(eq(events.id, event.id));
      const removed = await send(path, request); assert.equal(removed.status, 409); assert.equal(removed.body.current, undefined); assert.equal((await getEventSnapshot(event.id))!.deletedAt instanceof Date, true);
    }
    const event = content(), request = { ...event, recurrence: null, start: "2026-07-30T07:30:00Z", end: "2026-07-30T08:30:00Z", isAllDay: false };
    assert.equal((await send("/events", request)).status, 201);
    const saved = EventSchema.parse(await getEventSnapshot(event.id));
    const [link] = await db.insert(externalCalendars).values({ provider: "google", userID: owner, accountID: "fixture", externalCalendarID: "native", calendarID: calendar.id }).returning();
    const operationID = randomUUID();
    await db.insert(eventOutbox).values({ id: operationID, actorID: owner, mutationID: randomUUID(), position: 0, eventID: event.id, revision: 1, calendarID: calendar.id, externalCalendarLinkID: link.id, provider: "google", userID: owner, accountID: "fixture", externalCalendarID: "native", action: "create", payload: { event: saved, createIdentityVersion: 1 }, status: "unconfirmed", uncertain: true });
    const history = await db.select().from(eventOutbox).where(eq(eventOutbox.eventID, event.id));
    assert.equal((await send("/events", request)).status, 202);
    assert.deepEqual(await db.select().from(eventOutbox).where(eq(eventOutbox.eventID, event.id)), history, "replay neither appends nor drives uncertain native delivery");
    await db.update(externalCalendars).set({ disabled: true }).where(eq(externalCalendars.id, link.id));
    assert.equal((await send("/events", request)).status, 409);
    await db.update(externalCalendars).set({ disabled: false }).where(eq(externalCalendars.id, link.id));
    await db.delete(calendarMembers).where(eq(calendarMembers.calendarID, calendar.id));
    await db.update(events).set({ title: "Private after revocation", revision: 2 }).where(eq(events.id, event.id));
    const unavailable = await send("/events", request); assert.equal(unavailable.status, 409); assert.equal(unavailable.body.localCommitted, true); assert.equal(unavailable.body.current, undefined); assert.equal(JSON.stringify(unavailable.body).includes("Private after"), false);
    const oldHome = await createCalendar({ creatorID: owner, name: "Old home", color: "red" });
    const remaining = await createCalendar({ creatorID: other, name: "Private destination", color: "red" });
    const moved = { ...content(), calendars: [oldHome.id], start: "2026-07-30T07:30:00Z", end: "2026-07-30T08:30:00Z", isAllDay: false };
    assert.equal((await send("/events", moved)).status, 201);
    await db.insert(calendarEvents).values({ eventID: moved.id, calendarID: remaining.id });
    await db.delete(calendarEvents).where(and(eq(calendarEvents.eventID, moved.id), eq(calendarEvents.calendarID, oldHome.id)));
    await db.update(events).set({ title: "Private in remaining calendar", revision: 2 }).where(eq(events.id, moved.id));
    const unlinked = await send("/events", moved); assert.equal(unlinked.status, 409); assert.equal(unlinked.body.current, undefined); assert.equal(JSON.stringify(unlinked.body).includes("Private in"), false, "old origin grant cannot authorize an unlinked event");
    await db.insert(calendarMembers).values({ calendarID: remaining.id, userID: owner, role: "viewer" });
    const visible = await send("/events", moved); assert.equal(visible.status, 409); assert.equal(visible.body.current.title, "Private in remaining calendar", "a currently linked read grant permits the current conflict snapshot");
    assert.equal(providerRequests, 0);
    console.log("Creation retry HTTP/DB: legacy/known concurrent acceptance, exact current receipt, changed/deleted/private conflicts, no duplicate history or provider delivery: OK");
  } finally { config.api.eventTimeEditsEnabled = flag; globalThis.fetch = realFetch; server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await db.delete(user).where(eq(user.id, owner)); await db.delete(user).where(eq(user.id, other)); }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
