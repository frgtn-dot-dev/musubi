import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { createServer } from "node:http";
import type { Request, Response } from "express";
import { eq } from "drizzle-orm";
import { config } from "@musubi/config";
import { account, calendarEvents, calendarMembers, createCalendar, createEvent, db, eventOutbox, externalCalendars, externalEvents, queueProviderReminderEdit, getOwnProviderEventObservation, commitEventDeliveryResolution, getEventSnapshot, getOwnProviderEventState, getUserExternalCalendars, getUsersEvents, pendingNotifications, user } from "@musubi/db";
import { googleAdapter } from "./adapters/google";
import { syncProvider } from "./engine";
import { prepareEventDeliveryResolution } from "./event_resolution";
import { deliverEventOutbox } from "./event_delivery";
import { handlerStream } from "../handlers/stream";

async function main() {
  assert.equal(process.env.ENVIRONMENT, "test");
  const userID = `google-redaction-${randomUUID()}`, viewerID = `google-redaction-viewer-${randomUUID()}`;
  let role = "owner", failEvents = false, maskedReads = false;
  let eventsRequested = 0;
  let patches = 0, singleReads = 0;
  let gate: { at: number; entered: () => void; wait: Promise<void> } | undefined;
  const flag = config.api.providerReminderEditsEnabled;
  const native: any = { id: "native-event", etag: '"same-etag"', status: "confirmed", visibility: "private", summary: "Native secret title", description: "Native secret notes", location: "Native secret location", htmlLink: "https://calendar.example.test/private", organizer: { email: "native-private@example.test", self: false }, attendees: [{ email: "private-guest@example.test", self: true, responseStatus: "accepted" }], reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 30 }] }, start: { dateTime: "2026-09-15T09:00:00Z", timeZone: "UTC" }, end: { dateTime: "2026-09-15T10:00:00Z", timeZone: "UTC" } };
  const fixture = createServer(async (req, res) => {
    const url = new URL(req.url!, "http://fixture.test");
    assert.equal(req.headers.authorization, "Bearer fixture-access");
    res.setHeader("content-type", "application/json");
    const json = (body: unknown) => res.end(JSON.stringify(body));
    if (url.pathname === "/calendar/v3/users/me/calendarList") return json({ items: [{ id: "calendar", summary: "Fixture", backgroundColor: "#7A8BA3", accessRole: role }] });
    if (url.pathname === "/calendar/v3/users/me/calendarList/calendar") return json({ accessRole: role });
    if (url.pathname === "/tasks/v1/users/@me/lists") return json({ items: [] });
    if (url.pathname.endsWith("/events") || url.pathname.endsWith("/events/native-event")) {
      if (req.method === "PATCH") {
        assert.equal(url.searchParams.get("sendUpdates"), "none"); assert.equal(req.headers["if-match"], native.etag);
        let bytes = ""; for await (const chunk of req) bytes += chunk;
        const body = JSON.parse(bytes); assert.deepEqual(Object.keys(body), ["reminders"]);
        patches++; native.reminders = body.reminders; native.etag = '"after-reminder"'; return json(native);
      }
      assert.equal(req.method, "GET"); eventsRequested++;
      if (failEvents) { res.statusCode = 503; return json({ error: { message: "Unavailable" } }); }
      if (url.pathname.endsWith("native-event")) {
        singleReads++;
        const waiting = gate;
        if (waiting?.at === singleReads) { gate = undefined; waiting.entered(); await waiting.wait; }
      }
      const visible = maskedReads && role !== "owner" ? { ...native, summary: "Busy", description: undefined, location: undefined, htmlLink: undefined } : native;
      return json(url.pathname.endsWith("native-event") ? visible : { items: [visible], nextSyncToken: "fresh" });
    }
    res.statusCode = 500; return json({ error: { message: "Unexpected fixture request" } });
  });
  await new Promise<void>(resolve => fixture.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(fixture.address() as { port: number }).port}`;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const url = new URL(String(input)); assert.ok(["www.googleapis.com", "tasks.googleapis.com"].includes(url.hostname));
    return realFetch(`${origin}${url.pathname}${url.search}`, init);
  };
  await db.insert(user).values([{ id: userID, name: "Access", email: `${userID}@example.test` }, { id: viewerID, name: "Viewer", email: `${viewerID}@example.test` }]);
  const stream = new EventEmitter();
  const emitted: string[] = [];
  const response = Object.assign(stream, { destroyed: false, writableEnded: false, setHeader() {}, flushHeaders() {}, write(value: string) { emitted.push(value); return true; }, end() { response.writableEnded = true; } });
  const request = Object.assign(new EventEmitter(), { aborted: false, user: { id: viewerID, isExternal: true } });
  try {
    await db.insert(account).values({ id: randomUUID(), userId: userID, providerId: "google", accountId: "account", scope: "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/tasks", accessToken: "fixture-access", refreshToken: "fixture-refresh", accessTokenExpiresAt: new Date(Date.now() + 3600_000) });
    const sync = () => syncProvider(googleAdapter, userID, { id: "account", label: "Fixture" });
    await sync();
    const source = (await getUserExternalCalendars("google", userID, "account"))[0]!;
    const original = (await getUsersEvents(userID))[0]!.event;
    const [mapping] = await db.select().from(externalEvents).where(eq(externalEvents.eventID, original.id));
    const shared = await createCalendar({ creatorID: userID, name: "Linked", color: "#7A8BA3" });
    await db.insert(calendarEvents).values({ calendarID: shared.id, eventID: original.id });
    await db.insert(externalCalendars).values({ provider: "microsoft", userID, accountID: "linked-account", calendarID: shared.id, externalCalendarID: "linked" });
    await db.insert(calendarMembers).values({ calendarID: shared.id, userID: viewerID, role: "viewer" });
    await handlerStream(request as unknown as Request, response as unknown as Response);
    const draftID = randomUUID();
    await createEvent({ ...original, id: draftID, title: "Unmapped personal draft", description: "Keep my local draft", revision: 1 }, [source.calendarID]);
    const requestIntent = { provider: "google", operationID: randomUUID(), expectedRevision: original.revision, expectedStateVersion: (await getOwnProviderEventObservation(userID, original.id)).version, reminders: { useDefault: false, overrides: [] } };
    const { operationID } = await queueProviderReminderEdit(userID, original.id, requestIntent);
    const savedIntent = await db.select().from(eventOutbox).where(eq(eventOutbox.id, operationID));
    await db.insert(pendingNotifications).values({ userID: viewerID, kind: "event_changed", subjectID: original.id, payload: { title: original.title }, dueAt: new Date(Date.now() + 60_000) });
    const since = original.updatedAt;
    role = "reader"; failEvents = true;
    const beforeReads = eventsRequested;
    await assert.rejects(sync(), /Google 503/);
    assert.equal(eventsRequested, beforeReads + 1);
    const redacted = (await getEventSnapshot(original.id))!;
    assert.equal(redacted.title, "Busy");
    assert.equal(redacted.description, null); assert.equal(redacted.location, null); assert.equal(redacted.organizer, ""); assert.equal(redacted.url, null);
    assert.deepEqual([redacted.start, redacted.end, redacted.timeModel, redacted.seriesID, redacted.originalStart], [original.start, original.end, original.timeModel, original.seriesID, original.originalStart]);
    assert.equal(redacted.revision, original.revision + 1);
    assert.equal(await getOwnProviderEventState(userID, original.id), null);
    assert.equal((await getUsersEvents(viewerID, { since }))[0]!.event.title, "Busy");
    assert.equal((await getEventSnapshot(draftID))!.description, "Keep my local draft");
    const [protectedIntent] = await db.select().from(eventOutbox).where(eq(eventOutbox.id, operationID));
    assert.deepEqual(protectedIntent!.payload, savedIntent[0]!.payload, "Private saved intent is retained verbatim");
    assert.deepEqual([protectedIntent!.revision, protectedIntent!.status, protectedIntent!.uncertain, protectedIntent!.leaseToken, protectedIntent!.expectedEtag], [savedIntent[0]!.revision, savedIntent[0]!.status, savedIntent[0]!.uncertain, savedIntent[0]!.leaseToken, savedIntent[0]!.expectedEtag]);
    assert.equal(protectedIntent!.personalReadRecovery?.redactedRevision, redacted.revision);
    assert.equal((await db.select().from(pendingNotifications).where(eq(pendingNotifications.subjectID, original.id))).length, 0);
    const [currentMap] = await db.select().from(externalEvents).where(eq(externalEvents.eventID, original.id));
    assert.equal(currentMap!.id, mapping!.id); assert.equal(currentMap!.externalEventID, mapping!.externalEventID); assert.equal(currentMap!.etag, null);
    assert.ok(emitted.some(value => value.includes("external_sync") && value.includes(shared.id)), "Linked readers are invalidated before failed fetch returns");
    await assert.rejects(sync(), /Google 503/);
    assert.deepEqual(await getEventSnapshot(original.id), redacted, "Repeated unchanged discovery does not churn revisions");
    role = "owner";
    await assert.rejects(sync(), /Google 503/);
    assert.deepEqual(await getEventSnapshot(original.id), redacted, "Regaining access alone does not restore saved data");
    // Keep the REAL queued personal intent. Restore only from native evidence,
    // then explicitly confirm a fresh replacement; never delete the old journal.
    const beforeRestoration = emitted.filter(value => value.includes("external_sync") && value.includes(shared.id)).length;
    failEvents = false;
    const restoredCalendars = await sync();
    assert.ok(restoredCalendars.includes(shared.id));
    assert.ok(emitted.filter(value => value.includes("external_sync") && value.includes(shared.id)).length > beforeRestoration, "Linked readers receive the committed restoration as well");
    assert.equal((await getEventSnapshot(original.id))!.title, original.title);
    assert.equal((await getOwnProviderEventState(userID, original.id))?.organizer?.address, "native-private@example.test");
    assert.equal((await db.select().from(externalEvents).where(eq(externalEvents.eventID, original.id)))[0]!.id, mapping!.id);
    assert.equal(patches, 0, "Restoration itself performs no native write");
    assert.equal((await db.select().from(eventOutbox).where(eq(eventOutbox.eventID, original.id))).length, 1, "Restoration cannot fan out writes to linked providers");
    config.api.providerReminderEditsEnabled = true;
    const prepared = await prepareEventDeliveryResolution(userID, original.id, operationID, () => googleAdapter);
    assert.equal(prepared.preview.canResolve, true);
    const replacement = await commitEventDeliveryResolution(userID, prepared.proof, { mutationId: randomUUID(), expectedLocalRevision: prepared.preview.localRevision, expectedLatestOperationId: operationID, expectedRemoteExists: true, expectedRemoteEtag: prepared.preview.remoteEtag, expectedReminderStateVersion: prepared.preview.reminderResolution!.stateVersion });
    assert.equal((await deliverEventOutbox(replacement, () => googleAdapter))?.status, "completed");
    assert.equal(patches, 1);
    assert.deepEqual(native.reminders, requestIntent.reminders);
    const [archived] = await db.select().from(eventOutbox).where(eq(eventOutbox.id, operationID));
    assert.deepEqual(archived!.payload, savedIntent[0]!.payload);
    for (const pauseRead of [1, 2]) {
      const current = (await getEventSnapshot(original.id))!;
      const desired = pauseRead === 1 ? { useDefault: false, overrides: [{ method: "popup", minutes: 15 }] } : { useDefault: false, overrides: [] };
      const queued = await queueProviderReminderEdit(userID, original.id, { provider: "google", operationID: randomUUID(), expectedRevision: current.revision, expectedStateVersion: (await getOwnProviderEventObservation(userID, original.id)).version, reminders: desired });
      let reached!: () => void, release!: () => void;
      const waiting = new Promise<void>(resolve => { reached = resolve; });
      gate = { at: singleReads + pauseRead, entered: reached, wait: new Promise<void>(resolve => { release = resolve; }) };
      const patchesBefore: number = patches;
      const worker = deliverEventOutbox(queued.operationID, () => googleAdapter);
      try {
        await waiting;
        role = "reader"; failEvents = true; await assert.rejects(sync(), /Google 503/);
        role = "owner"; failEvents = false; await sync();
        release(); await worker;
        assert.equal(patches, patchesBefore, `Worker paused at native read ${pauseRead} cannot PATCH across access ABA`);
        const [retained] = await db.select().from(eventOutbox).where(eq(eventOutbox.id, queued.operationID));
        assert.equal(retained!.uncertain, true, "A claimed operation keeps its uncertainty through read restoration");
        const fresh = await prepareEventDeliveryResolution(userID, original.id, queued.operationID, () => googleAdapter);
        const next = await commitEventDeliveryResolution(userID, fresh.proof, { mutationId: randomUUID(), expectedLocalRevision: fresh.preview.localRevision, expectedLatestOperationId: queued.operationID, expectedRemoteExists: true, expectedRemoteEtag: fresh.preview.remoteEtag, expectedReminderStateVersion: fresh.preview.reminderResolution!.stateVersion });
        assert.equal((await deliverEventOutbox(next, () => googleAdapter))?.status, "completed");
        assert.equal(patches, patchesBefore + 1, "Only the explicitly confirmed replacement writes");
      } finally { release(); await worker; }
    }
    maskedReads = true; role = "reader"; await sync();
    assert.equal((await getEventSnapshot(original.id))!.title, "Busy");
    const [maskedMapping] = await db.select().from(externalEvents).where(eq(externalEvents.eventID, original.id));
    assert.equal(maskedMapping!.etag, native.etag);
    assert.ok(maskedMapping!.readRedactionRevision);
    role = "owner"; await sync();
    assert.equal((await getEventSnapshot(original.id))!.title, native.summary, "Fuller details restore even with the same ETag and provider-state projection");
    const [restoredMapping] = await db.select().from(externalEvents).where(eq(externalEvents.eventID, original.id));
    assert.deepEqual(restoredMapping!.providerState, maskedMapping!.providerState);
    assert.equal(restoredMapping!.readRedactionRevision, null);
    assert.equal((await db.select().from(eventOutbox).where(eq(eventOutbox.calendarID, shared.id))).length, 0, "Ordinary read restoration must not fan out provider writes either");
    const stable = await getEventSnapshot(original.id);
    await sync(); assert.deepEqual(await getEventSnapshot(original.id), stable, "Unchanged restored reads keep the canonical revision quiet");
    role = "reader"; await sync();
    assert.equal((await db.select().from(eventOutbox).where(eq(eventOutbox.calendarID, shared.id))).length, 0, "Initial limited read does not propagate redaction");
    maskedReads = false;
    native.summary = "Fresh public change under reader access";
    native.etag = '"public-reader-change"';
    await sync();
    assert.equal((await getEventSnapshot(original.id))!.title, native.summary);
    const propagated = await db.select().from(eventOutbox).where(eq(eventOutbox.calendarID, shared.id));
    assert.equal(propagated.length, 1, "Later genuine native changes under the same limited grant still propagate");
    await sync();
    assert.equal((await db.select().from(eventOutbox).where(eq(eventOutbox.calendarID, shared.id))).length, 1, "Repeated limited reads do not enqueue duplicates");
    console.log("Google mirror redaction: failed fetch, same-role no-op, linked deltas/SSE, stable identity/time, preserved draft/intent and fresh-only regain: OK");
  } finally {
    stream.emit("close"); globalThis.fetch = realFetch; config.api.providerReminderEditsEnabled = flag;
    await db.delete(user).where(eq(user.id, userID)); await db.delete(user).where(eq(user.id, viewerID));
    await new Promise<void>(resolve => fixture.close(() => resolve()));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
