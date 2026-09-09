import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { createServer } from "node:http";
import type { Request, Response } from "express";
import { eq } from "drizzle-orm";
import { account, calendarEvents, calendarMembers, calendars, createCalendar, db, eventOutbox, externalEvents, getEventSnapshot, getOwnProviderEventObservation, getUserExternalCalendars, getUsersEvents, pendingNotifications, queueProviderReminderEdit, removeGoogleCalendarMirrors, user } from "@musubi/db";
import { googleAdapter } from "./adapters/google";
import { syncProvider } from "./engine";
import { handlerStream } from "../handlers/stream";

async function main() {
  assert.equal(process.env.ENVIRONMENT, "test");
  const userID = `google-removal-${randomUUID()}`, viewerID = `linked-${randomUUID()}`, sourceViewerID = `source-${randomUUID()}`;
  let discovery: "initial" | "partial" | "freeBusyReader" | "absent" = "initial";
  let failEvents = false;
  const fixture = createServer((req, res) => {
    const url = new URL(req.url!, "http://fixture.test");
    assert.equal(req.method, "GET", "Removal must never write to the provider");
    assert.equal(req.headers.authorization, "Bearer fixture-access");
    res.setHeader("content-type", "application/json");
    const json = (body: unknown) => res.end(JSON.stringify(body));
    if (url.pathname === "/calendar/v3/users/me/calendarList") {
      if (url.searchParams.has("pageToken")) { res.statusCode = 503; return json({ error: { message: "Incomplete discovery" } }); }
      const cal = (id: string, accessRole = "owner") => ({ id, summary: id, backgroundColor: "#7A8BA3", accessRole });
      if (discovery === "partial") return json({ items: [cal("unrelated")], nextPageToken: "failed-page" });
      return json({ items: discovery === "initial" ? [cal("private"), cal("unrelated")] : discovery === "freeBusyReader" ? [cal("private", "freeBusyReader"), cal("unrelated")] : [] });
    }
    if (url.pathname === "/tasks/v1/users/@me/lists") return json({ items: [] });
    if (url.pathname.endsWith("/events")) {
      if (failEvents) { res.statusCode = 503; return json({ error: { message: "Unrelated fetch failed" } }); }
      return json({ items: url.pathname.includes("/private/") ? [{ id: "secret-event", etag: '"private-etag"', status: "confirmed", visibility: "private", summary: "Secret title", description: "Secret notes", location: "Secret room", htmlLink: "https://example.test/private", organizer: { email: "secret@example.test", self: true }, reminders: { useDefault: false, overrides: [] }, start: { dateTime: "2026-09-15T09:00:00Z", timeZone: "UTC" }, end: { dateTime: "2026-09-15T10:00:00Z", timeZone: "UTC" } }] : [], nextSyncToken: "fresh" });
    }
    res.statusCode = 500; return json({ error: { message: "Unexpected request" } });
  });
  await new Promise<void>(resolve => fixture.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(fixture.address() as { port: number }).port}`;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const url = new URL(String(input)); assert.ok(["www.googleapis.com", "tasks.googleapis.com"].includes(url.hostname));
    return realFetch(`${origin}${url.pathname}${url.search}`, init);
  };
  const streams: EventEmitter[] = [], emitted = new Map<string, string[]>();
  await db.insert(user).values([userID, viewerID, sourceViewerID].map(id => ({ id, name: id, email: `${id}@example.test` })));
  try {
    for (const id of [viewerID, sourceViewerID]) {
      const output: string[] = []; emitted.set(id, output);
      const stream = new EventEmitter(); streams.push(stream);
      const response = Object.assign(stream, { destroyed: false, writableEnded: false, setHeader() {}, flushHeaders() {}, write(value: string) { output.push(value); return true; }, end() { response.writableEnded = true; } });
      await handlerStream(Object.assign(new EventEmitter(), { aborted: false, user: { id, isExternal: true } }) as unknown as Request, response as unknown as Response);
    }
    await db.insert(account).values({ id: randomUUID(), userId: userID, providerId: "google", accountId: "account", scope: "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/tasks", accessToken: "fixture-access", refreshToken: "fixture-refresh", accessTokenExpiresAt: new Date(Date.now() + 3600_000) });
    const sync = () => syncProvider(googleAdapter, userID, { id: "account", label: "Fixture" });
    for (const mode of ["freeBusyReader", "absent"] as const) {
      discovery = "initial"; failEvents = false; await sync();
      const source = (await getUserExternalCalendars("google", userID, "account")).find(link => link.externalCalendarID === "private")!;
      const original = (await getUsersEvents(userID)).find(row => row.calendarID === source.calendarID)!.event;
      const linked = await createCalendar({ creatorID: userID, name: "Shared", color: "#7A8BA3" });
      await db.insert(calendarEvents).values({ calendarID: linked.id, eventID: original.id });
      await db.insert(calendarMembers).values([{ calendarID: linked.id, userID: viewerID, role: "viewer" }, { calendarID: source.calendarID, userID: sourceViewerID, role: "viewer" }]);
      const queued = await queueProviderReminderEdit(userID, original.id, { provider: "google", operationID: randomUUID(), expectedRevision: original.revision, expectedStateVersion: (await getOwnProviderEventObservation(userID, original.id)).version, reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 15 }] } });
      await db.update(eventOutbox).set({ status: "attempting", leaseToken: randomUUID(), leaseUntil: new Date(Date.now() + 60_000) }).where(eq(eventOutbox.id, queued.operationID));
      const [intent] = await db.select().from(eventOutbox).where(eq(eventOutbox.id, queued.operationID));
      await db.insert(pendingNotifications).values({ userID: viewerID, kind: "event_changed", subjectID: original.id, payload: { title: original.title }, dueAt: new Date() });
      assert.deepEqual(await removeGoogleCalendarMirrors(userID, "wrong-account", [source]), { calendarIDs: [], userIDs: [] });
      assert.deepEqual(await removeGoogleCalendarMirrors(userID, "account", [{ ...source, sourceID: randomUUID() }]), { calendarIDs: [], userIDs: [] });
      const beforeDisabled = await getEventSnapshot(original.id);
      await db.update(account).set({ syncStatus: "reconnect_required" }).where(eq(account.userId, userID));
      assert.deepEqual(await removeGoogleCalendarMirrors(userID, "account", [source]), { calendarIDs: [], userIDs: [] }, "Stale discovery cannot remove a source after its account stops syncing");
      assert.deepEqual(await getEventSnapshot(original.id), beforeDisabled);
      assert.ok((await getUserExternalCalendars("google", userID, "account")).some(link => link.sourceID === source.sourceID));
      await db.update(account).set({ syncStatus: "active" }).where(eq(account.userId, userID));
      const beforePartial = await getEventSnapshot(original.id);
      discovery = "partial";
      await assert.rejects(sync(), /Google 503/);
      assert.deepEqual(await getEventSnapshot(original.id), beforePartial, "Partial discovery preserves private content and revision");
      assert.ok((await getUserExternalCalendars("google", userID, "account")).some(link => link.sourceID === source.sourceID));
      for (const output of emitted.values()) output.length = 0;
      discovery = mode; failEvents = mode === "freeBusyReader";
      if (failEvents) await assert.rejects(sync(), /Google 503/);
      else {
        const changed = await sync(); assert.ok(changed.includes(source.calendarID)); assert.ok(changed.includes(linked.id));
      }
      const survivor = (await getEventSnapshot(original.id))!;
      assert.equal(survivor.title, "Busy"); assert.equal(survivor.description, null); assert.equal(survivor.location, null); assert.equal(survivor.url, null); assert.equal(survivor.organizer, "");
      assert.equal(survivor.originCalendarID, null); assert.ok(survivor.deletedAt);
      assert.equal(survivor.revision, original.revision + 2);
      assert.deepEqual([survivor.start, survivor.end, survivor.timeModel], [original.start, original.end, original.timeModel]);
      assert.equal((await db.select().from(calendars).where(eq(calendars.id, source.calendarID))).length, 0);
      assert.equal((await db.select().from(externalEvents).where(eq(externalEvents.eventID, original.id))).length, 0);
      assert.equal((await db.select().from(pendingNotifications).where(eq(pendingNotifications.subjectID, original.id))).length, 0);
      const [cancelled] = await db.select().from(eventOutbox).where(eq(eventOutbox.id, queued.operationID));
      assert.deepEqual(cancelled!.payload, intent!.payload); assert.equal(cancelled!.status, "cancelled"); assert.equal(cancelled!.errorCode, "destination-disconnected");
      assert.equal(cancelled!.uncertain, true); assert.equal(cancelled!.leaseToken, null); assert.equal(cancelled!.leaseUntil, null);
      for (const output of emitted.values()) assert.ok(output.some(value => value.includes("external_sync") && value.includes(source.calendarID) && value.includes(linked.id)), "Source-only and linked readers are notified before later fetch failure");
    }
    console.log("Google authoritative removal: redacted shared tombstones, incomplete discovery, source identity, cancellation and reader invalidation OK");
  } finally {
    for (const stream of streams) stream.emit("close"); globalThis.fetch = realFetch;
    for (const id of [userID, viewerID, sourceViewerID]) await db.delete(user).where(eq(user.id, id));
    await new Promise<void>(resolve => fixture.close(() => resolve()));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
