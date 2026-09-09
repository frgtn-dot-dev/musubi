import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import express from "express";
import { eq, sql } from "drizzle-orm";
import { config } from "@musubi/config";
import { CLIENT_VERSION_HEADER, PRODUCT_VERSION } from "@musubi/types";
import { account, calendarMembers, createCalendar, db, events, eventOutbox, externalCalendars, getEventSnapshot, importExternalCalendar, readGraphSeriesCreateReceipt, replaceMemberToken, user } from "@musubi/db";
import { issueMemberToken } from "../federation_tokens";
import { requireAuth } from "../middleware/require_auth";
import { middlewareErrorHandler } from "../middleware/error_handler";
import { handlerCreateEventTime } from "./events";

async function main() {
  assert.equal(process.env.ENVIRONMENT, "test");
  const owner = `graph-create-api-${randomUUID()}`, viewer = `graph-create-viewer-${randomUUID()}`;
  const token = issueMemberToken(), viewerToken = issueMemberToken(), flag = config.api.eventTimeEditsEnabled;
  for (const [id, credential] of [[owner, token], [viewer, viewerToken]] as const) {
    await db.insert(user).values({ id, name: "Fixture", email: `${id}@example.test`, isExternal: true }); await replaceMemberToken(id, credential.tokenHash);
  }
  await db.insert(account).values({ id: randomUUID(), userId: owner, providerId: "microsoft", accountId: "fixture", scope: "Calendars.ReadWrite", refreshToken: "fixture" });
  const calendar = await importExternalCalendar("microsoft", owner, "fixture", "Fixture", { externalId: "native-calendar", name: "Fixture", color: "red" });
  const local = await createCalendar({ creatorID: owner, name: "Local", color: "blue" });
  await db.insert(calendarMembers).values({ calendarID: calendar.id, userID: viewer, role: "viewer" });
  const app = express(); app.use(express.json()); app.post("/events/time", requireAuth, handlerCreateEventTime); app.use(middlewareErrorHandler);
  const server = app.listen(0, "127.0.0.1"); await new Promise<void>(resolve => server.once("listening", resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const realFetch = globalThis.fetch; let providerRequests = 0;
  globalThis.fetch = (input, init) => { if (new URL(String(input)).origin === "https://graph.microsoft.com") { providerRequests++; throw new Error("Creation admission must not contact Graph"); } return realFetch(input, init); };
  const make = () => ({ event: { id: randomUUID(), creatorID: "untrusted", organizer: "untrusted", title: "API series", color: "red", calendars: [calendar.id], isCanceled: false, hasAttendees: false, recurrence: "RRULE:FREQ=DAILY;COUNT=4" }, time: { kind: "zoned", timeZone: "Europe/Prague", startLocal: "2026-03-27T09:00:00", endLocal: "2026-03-27T10:00:00" } });
  const send = async (body: unknown, credential: string | null = token.raw, key?: string) => {
    const response = await realFetch(origin + "/events/time", { method: "POST", headers: { "content-type": "application/json", [CLIENT_VERSION_HEADER]: PRODUCT_VERSION, ...(credential ? { authorization: `Bearer ${credential}` } : {}), ...(key ? { "Idempotency-Key": key } : {}) }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json(), cache: response.headers.get("cache-control") };
  };
  const history = () => db.select().from(eventOutbox).where(eq(eventOutbox.userID, owner)).orderBy(eventOutbox.id);
  const privateFields = /"(?:graphSeriesCreate|nativeEvent|createIdentityVersion|transactionId|externalCalendarID|accountID|refreshToken|scope)"/;
  try {
    const request = make();
    config.api.eventTimeEditsEnabled = false; assert.equal((await send(request)).status, 403); assert.equal(await getEventSnapshot(request.event.id), undefined);
    config.api.eventTimeEditsEnabled = true;
    assert.equal((await send(request, null)).status, 401); assert.equal((await send(request, viewerToken.raw)).status, 403);
    assert.equal((await send({ ...request, event: { ...request.event, seriesID: randomUUID() } })).status, 400);
    assert.equal((await send(request, token.raw, "invalid-key")).status, 400);
    for (const patch of [{ hasAttendees: true }, { url: "https://meeting.test" }, { recurrence: "RRULE:FREQ=DAILY;COUNT=367" }, { recurrence: "RRULE:FREQ=DAILY" }, { recurrence: "invalid" }]) {
      const invalid = make(); assert.equal((await send({ ...invalid, event: { ...invalid.event, ...patch } })).status, 403); assert.equal(await getEventSnapshot(invalid.event.id), undefined);
    }
    const subdaily = make();
    assert.equal((await send({ ...subdaily, event: { ...subdaily.event, recurrence: "RRULE:FREQ=HOURLY;COUNT=4" } })).status, 400);
    assert.equal(await getEventSnapshot(subdaily.event.id), undefined);
    for (const time of [{ kind: "floating", startLocal: "2026-03-27T09:00:00", endLocal: "2026-03-27T10:00:00" }, { ...request.time, startLocal: "2026-03-29T02:30:00", endLocal: "2026-03-29T03:30:00" }, { ...request.time, startLocal: "2026-10-25T02:30:00", endLocal: "2026-10-25T03:30:00" }]) {
      const invalid = make(); assert.equal((await send({ ...invalid, time })).status, 403); assert.equal(await getEventSnapshot(invalid.event.id), undefined);
    }
    const multiple = make(); assert.equal((await send({ ...multiple, event: { ...multiple.event, calendars: [calendar.id, local.id] } })).status, 400); assert.equal(await getEventSnapshot(multiple.event.id), undefined);
    assert.equal((await history()).length, 0);
    const created = await send(request); assert.equal(created.status, 202, JSON.stringify(created.body)); assert.equal(created.body.localCommitted, true); assert.equal(created.cache, "private, no-store");
    assert.equal(created.body.id, request.event.id); assert.equal(created.body.creatorID, owner); assert.equal(created.body.organizer, owner); assert.equal(created.body.revision, 1);
    assert.equal(created.body.timeModel.kind, "zoned"); assert.equal(privateFields.test(JSON.stringify(created.body)), false);
    const first = (await history())[0]!; assert.equal(first.mutationID, request.event.id); assert.equal(first.status, "pending"); assert.equal(first.payload.graphSeriesCreate!.nativeEvent.organizer, "");
    const [a, b] = await Promise.all([send(request), send(request)]); assert.equal(a.status, 202); assert.equal(b.status, 202); assert.equal((await history()).length, 1);
    assert.deepEqual(a.body, created.body); assert.deepEqual(b.body, created.body);
    assert.equal((await send({ ...request, event: { ...request.event, title: "Different intent" } })).status, 400);
    assert.equal((await send(request, token.raw, randomUUID())).status, 400); assert.equal((await history()).length, 1);
    await db.update(events).set({ title: "Current canonical title", revision: 2 }).where(eq(events.id, request.event.id));
    const replay = await send(request); assert.equal(replay.status, 202); assert.equal(replay.body.title, "Current canonical title"); assert.equal(replay.body.revision, 2);
    await db.update(events).set({ deletedAt: new Date() }).where(eq(events.id, request.event.id));
    const removed = await send(request); assert.equal(removed.status, 409); assert.equal(removed.body.localCommitted, true); assert.equal(removed.body.code, "event-create-no-longer-active"); assert.equal(removed.body.title, undefined);
    assert.equal((await history()).length, 1);
    const day = make(), dayKey = randomUUID();
    const dayRequest = { ...day, time: { kind: "all-day", startDate: "2026-12-30", endDate: "2026-12-31" } };
    assert.equal((await send(dayRequest, token.raw, dayKey)).status, 202); assert.equal((await send(dayRequest, token.raw, dayKey.toUpperCase())).status, 202);
    assert.equal((await history()).length, 2); assert.equal((await history()).find(row => row.eventID === day.event.id)!.mutationID, dayKey);
    await db.update(externalCalendars).set({ disabled: true }).where(eq(externalCalendars.calendarID, calendar.id));
    assert.equal((await send(dayRequest, token.raw, dayKey)).status, 409);
    await db.update(externalCalendars).set({ disabled: false }).where(eq(externalCalendars.calendarID, calendar.id));
    await db.update(account).set({ scope: "" }).where(eq(account.userId, owner));
    assert.equal((await send(dayRequest, token.raw, dayKey)).status, 202, "existing readable receipt needs no renewed OAuth write grant");
    await db.update(account).set({ scope: "Calendars.ReadWrite" }).where(eq(account.userId, owner));
    const localRequest = make(); const localResponse = await send({ ...localRequest, event: { ...localRequest.event, calendars: [local.id] } }); assert.equal(localResponse.status, 201);
    const google = await createCalendar({ creatorID: owner, name: "Google", color: "red" });
    await db.insert(externalCalendars).values({ provider: "google", userID: owner, accountID: owner, externalCalendarID: "google", calendarID: google.id });
    const other = make(); assert.equal((await send({ ...other, event: { ...other.event, calendars: [google.id] } })).status, 400); assert.equal(await getEventSnapshot(other.event.id), undefined);
    const notificationRequest = make(), query = db.$client.query.bind(db.$client); let notificationFailed = false;
    (db.$client as any).query = async (statement: any, ...args: any[]) => {
      const text = typeof statement === "string" ? statement : statement.text;
      if (text.includes('from "calendar_members"')) {
        const existing = await query('select id from events where id = $1', [notificationRequest.event.id]);
        if (existing.rows.length) { notificationFailed = true; throw new Error("synthetic notification failure"); }
      }
      return (query as any)(statement, ...args);
    };
    let failed;
    try { failed = await send(notificationRequest); } finally { db.$client.query = query; }
    assert.equal(notificationFailed, true); assert.equal(failed.status, 502); assert.equal(failed.body.localCommitted, true); assert.equal(failed.body.committed[0].id, notificationRequest.event.id); assert.equal(privateFields.test(JSON.stringify(failed.body)), false);
    const late = make(), trigger = `graph_api_revoke_${randomUUID().replace(/-/g, "")}`;
    await db.execute(sql.raw(`CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN DELETE FROM calendar_members WHERE calendar_id = '${calendar.id}'::uuid; RETURN NEW; END $$`));
    try {
      await db.execute(sql.raw(`CREATE TRIGGER ${trigger} AFTER INSERT ON event_outbox FOR EACH ROW WHEN (NEW.event_id = '${late.event.id}'::uuid) EXECUTE FUNCTION ${trigger}()`));
      const unavailable = await send(late); assert.equal(unavailable.status, 409); assert.equal(unavailable.body.localCommitted, true); assert.equal(unavailable.body.title, undefined);
      const operation = (await history()).find(row => row.eventID === late.event.id)!;
      await db.update(events).set({ title: "Later private edit" }).where(eq(events.id, late.event.id));
      assert.deepEqual(await readGraphSeriesCreateReceipt(owner, operation.id), { kind: "unavailable" });
      const revokedReplay = await send(late); assert.equal(revokedReplay.status, 409); assert.equal(revokedReplay.body.localCommitted, true); assert.equal(revokedReplay.body.title, undefined);
      assert.equal((await send({ ...late, event: { ...late.event, title: "Changed after revocation" } })).status, 400);
    } finally { await db.execute(sql.raw(`DROP TRIGGER IF EXISTS ${trigger} ON event_outbox`)); await db.execute(sql.raw(`DROP FUNCTION ${trigger}()`)); }
    assert.equal(providerRequests, 0, "HTTP acceptance never claims or performs native delivery");
    console.log("Graph create HTTP: strict gated personal request, actor/time projection, stable keyed/default retries, current/deleted/permission-safe receipt, honest post-commit failure and no provider IO: OK");
  } finally { config.api.eventTimeEditsEnabled = flag; globalThis.fetch = realFetch; server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await db.delete(user).where(eq(user.id, viewer)); await db.delete(user).where(eq(user.id, owner)); }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
