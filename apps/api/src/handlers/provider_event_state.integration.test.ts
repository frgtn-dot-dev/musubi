import { config } from "@musubi/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import express from "express";
import { and, eq } from "drizzle-orm";
import { CLIENT_VERSION_HEADER, PRODUCT_VERSION } from "@musubi/types";
import { createCalendar, db, user, calendarMembers, externalCalendars, externalEvents, events, eventOutbox, getEventSnapshot, getOwnProviderEventState, replaceMemberToken, upsertExternalEvent, claimEventOutbox, completeEventOutbox } from "@musubi/db";
import { googleEventState } from "../sync/adapters/provider_event_state";
import { issueMemberToken } from "../federation_tokens";
import { requireAuth } from "../middleware/require_auth";
import { middlewareErrorHandler } from "../middleware/error_handler";
import { handlerGetProviderEventState } from "./events";

async function main() {
  assert.equal(process.env.ENVIRONMENT, "test");
  const previousReminderFlag = config.api.providerReminderEditsEnabled;
  config.api.providerReminderEditsEnabled = false;
  const owner = `provider-state-${randomUUID()}`;
  const viewer = `provider-state-viewer-${randomUUID()}`;
  const token = issueMemberToken();
  const viewerToken = issueMemberToken();
  for (const [id, credential] of [[owner, token], [viewer, viewerToken]] as const) {
    await db.insert(user).values({ id, name: id, email: `${id}@example.test`, isExternal: true });
    await replaceMemberToken(id, credential.tokenHash);
  }
  const calendar = await createCalendar({ creatorID: owner, name: "Provider", color: "red" });
  await db.insert(calendarMembers).values({ calendarID: calendar.id, userID: viewer, role: "viewer" });
  const [link] = await db.insert(externalCalendars).values({ provider: "google", userID: owner, accountID: randomUUID(), calendarID: calendar.id, externalCalendarID: "source" }).returning();
  const values = { title: "Meeting", color: "red", start: new Date("2026-09-10T09:00:00Z"), end: new Date("2026-09-10T10:00:00Z"), isAllDay: false, description: null, location: null, organizer: "", recurrence: null, url: null };
  const state = googleEventState({ organizer: { email: "host@example.test", self: false }, attendees: [{ email: "guest@example.test", self: true, responseStatus: "accepted" }], reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 15 }] }, visibility: "private" });
  await upsertExternalEvent("google", owner, calendar.id, "source", "meeting", values, '"v1"');
  const [mapping] = await db.select().from(externalEvents).where(eq(externalEvents.calendarID, calendar.id));
  const initial = (await getEventSnapshot(mapping.eventID))!;
  const observe = (next = state, etag = '"v1"') => upsertExternalEvent("google", owner, calendar.id, "source", "meeting", values, etag, null, undefined, undefined, undefined, next);
  const app = express();
  app.get("/events/:eventId/provider-state", requireAuth, handlerGetProviderEventState);
  app.use(middlewareErrorHandler);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const read = async (credential: string | null = token.raw) => {
    const response = await fetch(`${origin}/events/${mapping.eventID}/provider-state`, { headers: { ...(credential ? { authorization: `Bearer ${credential}` } : {}), [CLIENT_VERSION_HEADER]: PRODUCT_VERSION } });
    return { status: response.status, body: await response.json() };
  };
  try {
    assert.equal(await getOwnProviderEventState(owner, mapping.eventID), null);
    assert.equal(await observe(), true, "adopt metadata even at an unchanged ETag");
    assert.equal(await observe(), false);
    assert.equal((await getEventSnapshot(mapping.eventID))!.revision, initial.revision);
    assert.equal((await db.select().from(eventOutbox).where(eq(eventOutbox.eventID, mapping.eventID))).length, 0);
    assert.deepEqual((await read()).body.state, state);
    assert.match((await read()).body.version, /^[0-9a-f]{64}$/);
    assert.equal((await read()).body.reminderEdit, undefined, "disabled server cannot advertise editor");
    config.api.providerReminderEditsEnabled = true;
    assert.deepEqual((await read()).body.reminderEdit, { provider: "google", expectedRevision: initial.revision });
    await db.update(calendarMembers).set({ role: "viewer" }).where(and(eq(calendarMembers.calendarID, calendar.id), eq(calendarMembers.userID, owner)));
    assert.equal((await read()).body.reminderEdit, undefined);
    await db.update(calendarMembers).set({ role: "owner" }).where(and(eq(calendarMembers.calendarID, calendar.id), eq(calendarMembers.userID, owner)));
    await db.update(events).set({ timeModel: { kind: "floating", startLocal: "2026-09-10T09:00:00.000", endLocal: "2026-09-10T10:00:00.000" } }).where(eq(events.id, initial.id));
    assert.equal((await read()).body.reminderEdit, undefined);
    await db.update(events).set({ timeModel: null }).where(eq(events.id, initial.id));
    await observe({ ...state, reminders: { provider: "google", useDefault: false, overrides: [{ method: "unknown-native", minutes: 15 }] } });
    assert.equal((await read()).body.reminderEdit, undefined, "unrepresentable preferences must not be silently replaced by a draft");
    await observe(state);
    assert.equal((await read(null)).status, 401);
    assert.deepEqual(await read(viewerToken.raw), { status: 200, body: { state: null, version: null } });
    await db.update(externalCalendars).set({ disabled: true }).where(eq(externalCalendars.id, link.id));
    assert.equal(await getOwnProviderEventState(owner, mapping.eventID), null);
    await db.update(externalCalendars).set({ disabled: false }).where(eq(externalCalendars.id, link.id));
    const operationID = randomUUID();
    await db.insert(eventOutbox).values({ id: operationID, actorID: owner, mutationID: randomUUID(), position: 0, revision: initial.revision, eventID: initial.id, calendarID: calendar.id, externalCalendarLinkID: link.id, provider: "google", userID: owner, accountID: link.accountID, externalCalendarID: "source", externalEventID: "meeting", action: "update", payload: { event: initial }, expectedEtag: '"v1"' });
    assert.equal(await observe(), false);
    assert.equal((await db.select().from(eventOutbox).where(eq(eventOutbox.id, operationID)))[0].status, "pending", "unchanged baseline must not block an unattempted local write");
    const changed = { ...state, ownResponse: "tentative" };
    assert.equal(await observe(changed, '"v2"'), false);
    assert.deepEqual(await getOwnProviderEventState(owner, initial.id), state, "pending write cannot accept incoming personal state");
    const [pending] = await db.select().from(eventOutbox).where(eq(eventOutbox.id, operationID));
    assert.equal(pending.status, "conflict");
    assert.deepEqual(pending.remoteSnapshot?.providerState, changed);
    await db.update(eventOutbox).set({ status: "cancelled" }).where(eq(eventOutbox.id, operationID));
    assert.equal(await observe(changed, '"v2"'), true);
    assert.deepEqual(await getOwnProviderEventState(owner, initial.id), changed);
    // A provider echo may arrive before its write ACK, at a different ETag.
    const echoID = randomUUID();
    await db.insert(eventOutbox).values({ ...pending, id: echoID, mutationID: randomUUID(), status: "pending", remoteSnapshot: null, expectedEtag: '\"v2\"' });
    const claimed = (await claimEventOutbox(echoID))!;
    assert.ok(claimed?.leaseToken);
    const echoState = { ...state, ownResponse: "declined" };
    assert.equal(await observe(echoState, '\"echo\"'), false);
    assert.equal(await observe(changed, '\"v2\"'), false, "a newer reversion at the accepted ETag must replace the pending echo");
    const result = await completeEventOutbox(echoID, claimed.leaseToken!, { externalEventId: "meeting", etag: '\"ack\"' }, { externalEventId: "meeting", etag: '\"v2\"' });
    assert.equal(result?.status, "completed");
    assert.deepEqual(await getOwnProviderEventState(owner, initial.id), changed);
    // A delayed retained observation must not replace newer accepted evidence.
    const staleID = randomUUID();
    await db.insert(eventOutbox).values({ ...pending, id: staleID, mutationID: randomUUID(), status: "pending", expectedEtag: '\"ack\"', remoteSnapshot: { isEcho: true, externalEventId: "meeting", etag: '\"old\"', deleted: false, observedAt: "2000-01-01T00:00:00.000Z", providerState: state } });
    const staleClaim = (await claimEventOutbox(staleID))!;
    assert.equal((await completeEventOutbox(staleID, staleClaim.leaseToken!, { externalEventId: "meeting", etag: '\"ack2\"' }, { externalEventId: "meeting", etag: '\"ack\"' }))?.status, "completed");
    assert.deepEqual(await getOwnProviderEventState(owner, initial.id), changed);
    await db.update(events).set({ deletedAt: new Date() }).where(eq(events.id, initial.id));
    assert.equal(await getOwnProviderEventState(owner, initial.id), null);
    await db.update(events).set({ deletedAt: null }).where(eq(events.id, initial.id));
    await db.delete(calendarMembers).where(and(eq(calendarMembers.calendarID, calendar.id), eq(calendarMembers.userID, owner)));
    assert.equal(await getOwnProviderEventState(owner, initial.id), null);
    assert.equal((await read()).status, 403);
  } finally {
    config.api.providerReminderEditsEnabled = previousReminderFlag;
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    for (const id of [owner, viewer]) await db.delete(user).where(eq(user.id, id));
  }
  console.log("Provider state HTTP/DB: private source identity, metadata adoption, no fanout, pending retention and revocation: OK");
}
main().finally(() => db.$client.end());
