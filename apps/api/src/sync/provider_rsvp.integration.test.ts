import express from "express";
import { CLIENT_VERSION_HEADER, PRODUCT_VERSION, ProviderRsvpReceiptSchema } from "@musubi/types";
import { replaceMemberToken } from "@musubi/db";
import { issueMemberToken } from "../federation_tokens";
import { requireAuth } from "../middleware/require_auth";
import { middlewareErrorHandler } from "../middleware/error_handler";
import { handlerProviderRsvpEdit } from "../handlers/events";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { eq, and } from "drizzle-orm";
import { config } from "@musubi/config";
import { db, user, account, events, eventOutbox, externalCalendars, externalEvents, calendarMembers, createCalendar, upsertExternalEvent, getEventSnapshot, getOwnProviderEventObservation, getEventDeliveryStatus, completeEventOutbox } from "@musubi/db";
import { queueGoogleRsvp } from "./provider_rsvp";
import { googleEventState } from "./adapters/provider_event_state";
import { googleAdapter } from "./adapters/google";
import { deliverEventOutbox } from "./event_delivery";

async function main() {
  assert.equal(process.env.ENVIRONMENT, "test");
  const oldFlag = config.api.providerRsvpEditsEnabled;
  const oldTimeFlag = config.api.eventTimeEditsEnabled; const oldReminderFlag = config.api.providerReminderEditsEnabled;
  config.api.eventTimeEditsEnabled = false; config.api.providerReminderEditsEnabled = false;
  let mode = "normal";
  let remote: any, beforeRead: (() => Promise<void>) | undefined;
  let http = 0, reads = 0, patches = 0;
  const server = createServer(async (req, res) => {
    http++;
    assert.equal(req.headers.authorization, "Bearer synthetic-rsvp-access");
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/calendar/v3/users/me/calendarList/primary") { res.end(JSON.stringify({ id: "guest@example.test", primary: true, accessRole: "owner" })); return; }
    if (req.url?.startsWith("/calendar/v3/calendars/guest%40example.test/events?") && req.method === "GET") { res.end(JSON.stringify({ items: [remote], nextSyncToken: "next" })); return; }
    if (req.method === "PATCH") {
      assert.equal(req.url, "/calendar/v3/calendars/guest%40example.test/events/meeting?sendUpdates=all&conferenceDataVersion=1");
      patches++; assert.equal(req.headers["if-match"], remote.etag);
      let body = ""; for await (const chunk of req) body += chunk;
      assert.deepEqual(JSON.parse(body), { attendeesOmitted: true, attendees: [{ email: "guest@example.test", responseStatus: "accepted" }] });
      remote.attendees[0].responseStatus = "accepted"; remote.etag = '\"v2\"';
      if (mode === "lost") { req.socket.destroy(); return; }
      if (mode === "applied-503") { res.writeHead(503); res.end(); return; }
      res.end(JSON.stringify(remote)); return;
    }
    assert.equal(req.url, "/calendar/v3/calendars/guest%40example.test/events/meeting");
    assert.equal(req.method, "GET"); reads++;
    if (beforeRead) { const action = beforeRead; beforeRead = undefined; await action(); }
    res.end(JSON.stringify(remote));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const realFetch = globalThis.fetch;
  const app = express(); app.use(express.json());
  app.post("/api/v1/events/:eventId/provider-rsvp", requireAuth, handlerProviderRsvpEdit);
  app.use(middlewareErrorHandler);
  const api = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => api.once("listening", resolve));
  const apiAddress = api.address(); assert.ok(apiAddress && typeof apiAddress !== "string");
  const apiOrigin = `http://127.0.0.1:${apiAddress.port}`;

  globalThis.fetch = (input, init) => { const url = new URL(String(input)); assert.equal(url.origin, "https://www.googleapis.com", "No live requests allowed"); return realFetch(`http://127.0.0.1:${address.port}${url.pathname}${url.search}`, init); };
  try {
    for (const scenario of ["queue", "concurrent", "disabled", "wrong-user", "wrong-scope", "viewer", "revision-race", "role-race", "mapping-race", "native-state-race", "native-time-race", "known-zoned", "known-all-day", "worker-disabled", "lost", "applied-503", "worker-role-race", "ack-role-race", "lease-race", "pull-baseline", "pull-echo", "pull-state-conflict", "pull-zone-conflict", "legacy-pull-zone-conflict", "pull-native-comment-conflict"]) {
      mode = "normal"; patches = 0;
      console.log(`RSVP DB scenario: ${scenario}`);
      const owner = `rsvp-${randomUUID()}`;
      remote = { id: "meeting", etag: '\"v1\"', status: "confirmed", summary: "Private meeting", start: { dateTime: "2026-09-10T11:00:00+02:00", timeZone: "Europe/Prague" }, end: { dateTime: "2026-09-10T12:00:00+02:00", timeZone: "Europe/Prague" }, organizer: { email: "host@example.test", self: false }, attendees: [{ email: "guest@example.test", self: true, responseStatus: "needsAction", comment: "Private attendee comment" }, { email: "other@example.test", responseStatus: "accepted" }], reminders: { useDefault: true }, conferenceData: { entryPoints: [{ uri: "https://meet.example.test/private" }] }, extendedProperties: { private: { secret: "Private baseline" } } };
      if (scenario === "known-all-day") { remote.start = { date: "2026-09-10" }; remote.end = { date: "2026-09-11" }; }
      await db.insert(user).values({ id: owner, name: owner, email: `${owner}@example.test`, isExternal: true });
      try {
        const accountID = randomUUID();
        await db.insert(account).values({ id: accountID, userId: owner, providerId: "google", accountId: "fixture", scope: scenario === "wrong-scope" ? "openid email" : "https://www.googleapis.com/auth/calendar.events", accessToken: "synthetic-rsvp-access", refreshToken: "synthetic-rsvp-refresh", accessTokenExpiresAt: new Date(Date.now() + 3600000) });
        const calendar = await createCalendar({ creatorID: owner, name: "RSVP fixture", color: "red" });
        const [link] = await db.insert(externalCalendars).values({ provider: "google", userID: owner, accountID: "fixture", calendarID: calendar.id, externalCalendarID: "guest@example.test" }).returning();
        await upsertExternalEvent("google", owner, calendar.id, "guest@example.test", remote.id, { title: remote.summary, color: "red", start: new Date(remote.start.dateTime ?? "2026-09-10T00:00:00Z"), end: new Date(remote.end.dateTime ?? "2026-09-10T00:00:00Z"), isAllDay: !!remote.start.date, description: null, location: null, organizer: remote.organizer.email, recurrence: null, url: null }, remote.etag, null, undefined, undefined, undefined, googleEventState(remote));
        const [mapping] = await db.select().from(externalEvents).where(eq(externalEvents.calendarID, calendar.id));
        if (scenario.startsWith("known-") || scenario.startsWith("pull-")) await db.update(events).set({ timeModel: scenario === "known-all-day" ? { kind: "all-day" } : { kind: "zoned", timeZone: "Europe/Prague", startLocal: "2026-09-10T11:00:00.000", endLocal: "2026-09-10T12:00:00.000" } }).where(eq(events.id, mapping!.eventID));
        const original = (await getEventSnapshot(mapping!.eventID))!;
        const observation = await getOwnProviderEventObservation(owner, original.id);
        const request = { provider: "google", operationID: randomUUID(), expectedRevision: original.revision, expectedStateVersion: observation.version, response: "accepted", sendUpdates: "all" };
        config.api.providerRsvpEditsEnabled = scenario !== "disabled";
        const member = and(eq(calendarMembers.calendarID, calendar.id), eq(calendarMembers.userID, owner));
        if (scenario === "viewer") await db.update(calendarMembers).set({ role: "viewer" }).where(member);
        if (scenario === "revision-race") beforeRead = async () => { await db.update(events).set({ revision: original.revision + 1 }).where(eq(events.id, original.id)); };
        if (scenario === "role-race") beforeRead = async () => { await db.update(calendarMembers).set({ role: "viewer" }).where(member); };
        if (scenario === "mapping-race") beforeRead = async () => { await db.update(externalEvents).set({ etag: '\"new\"' }).where(eq(externalEvents.id, mapping!.id)); };
        if (scenario === "native-state-race") beforeRead = async () => { remote.attendees[1].responseStatus = "declined"; };
        if (scenario === "native-time-race") beforeRead = async () => { remote.end.dateTime = "2026-09-10T13:00:00+02:00"; };
        const credential = issueMemberToken();
        await replaceMemberToken(owner, credential.tokenHash);
        const post = (body: unknown, token: string | null = credential.raw, id = original.id, version = PRODUCT_VERSION) => realFetch(`${apiOrigin}/api/v1/events/${id}/provider-rsvp`, { method: "POST", headers: { "Content-Type": "application/json", [CLIENT_VERSION_HEADER]: version, ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
        if (scenario === "queue") {
          assert.equal(observation.rsvpEdit, undefined, "Capability defaults off");
          assert.deepEqual((await getOwnProviderEventObservation(owner, original.id, false, true)).rsvpEdit, { provider: "google", expectedRevision: original.revision });
          const state = googleEventState(remote);
          for (const unsupported of [
            { ...state, attendeesComplete: false },
            { ...state, isOrganizer: true },
            { ...state, organizer: { ...state.organizer!, address: "guest@example.test" } },
            { ...state, attendees: state.attendees.map(item => ({ ...item, self: false })) },
            { ...state, attendees: state.attendees.map(item => ({ ...item, self: true })) },
            { ...state, attendees: state.attendees.map(item => item.self ? { ...item, address: "different@example.test" } : item) },
            { ...state, attendees: [...state.attendees, ...Array.from({ length: 199 }, () => state.attendees[1]!)] },
            { ...state, eventType: "outOfOffice" },
            { ...state, status: "cancelled" },
          ]) {
            await db.update(externalEvents).set({ providerState: unsupported }).where(eq(externalEvents.id, mapping!.id));
            assert.equal((await getOwnProviderEventObservation(owner, original.id, false, true)).rsvpEdit, undefined);
          }
          await db.update(externalEvents).set({ providerState: state, etag: 'W/"weak"' }).where(eq(externalEvents.id, mapping!.id));
          assert.equal((await getOwnProviderEventObservation(owner, original.id, false, true)).rsvpEdit, undefined);
          await db.update(externalEvents).set({ etag: remote.etag }).where(eq(externalEvents.id, mapping!.id));
          for (const edit of [{ recurrence: "RRULE:FREQ=DAILY" }, { timeModel: { kind: "floating" as const, startLocal: "2026-09-10T11:00:00.000", endLocal: "2026-09-10T12:00:00.000" } }, { isCanceled: true }]) {
            await db.update(events).set(edit).where(eq(events.id, original.id));
            assert.equal((await getOwnProviderEventObservation(owner, original.id, false, true)).rsvpEdit, undefined);
            await db.update(events).set({ recurrence: original.recurrence, timeModel: original.timeModel, isCanceled: original.isCanceled, updatedAt: original.updatedAt }).where(eq(events.id, original.id));
          }
          const before = http;
          assert.equal((await post(request, null)).status, 401);
          assert.equal((await post(request, "invalid-token")).status, 401);
          assert.equal((await post(request, credential.raw, original.id, "0.0.1")).status, 426);
          assert.equal((await post(request, credential.raw, "not-a-uuid")).status, 400);
          assert.equal((await post(request, credential.raw, randomUUID())).status, 403);
          for (const invalid of [{ ...request, sendUpdates: "none" }, { ...request, selfEmail: "host@example.test" }, { ...request, response: "needsAction" }, { ...request, expectedStateVersion: "stale" }]) assert.equal((await post(invalid)).status, 400);
          config.api.providerRsvpEditsEnabled = false;
          assert.equal((await post(request)).status, 403);
          config.api.providerRsvpEditsEnabled = true;
          await db.update(calendarMembers).set({ role: "viewer" }).where(member);
          assert.equal((await post(request)).status, 403);
          await db.update(calendarMembers).set({ role: "owner" }).where(member);
          const other = `rsvp-other-${randomUUID()}`;
          const otherCredential = issueMemberToken();
          await db.insert(user).values({ id: other, name: other, email: `${other}@example.test`, isExternal: true });
          try {
            await replaceMemberToken(other, otherCredential.tokenHash);
            await db.insert(calendarMembers).values({ calendarID: calendar.id, userID: other, role: "editor" });
            assert.equal((await post(request, otherCredential.raw)).status, 403, "Shared calendar editing does not authorize another account's RSVP");
          } finally { await db.delete(user).where(eq(user.id, other)); }
          assert.equal(http, before, "HTTP authorization/validation failures must never read provider data");
          assert.equal((await db.select().from(eventOutbox).where(eq(eventOutbox.eventID, original.id))).length, 0);
        }
        const previousHttp = http;
        const send = async () => {
          if (scenario !== "queue") return queueGoogleRsvp(scenario === "wrong-user" ? "outsider" : owner, original.id, request);
          const response = await post(request);
          assert.equal(response.status, 202); assert.equal(response.headers.get("cache-control"), "private, no-store");
          const receipt = ProviderRsvpReceiptSchema.parse(await response.json());
          assert.equal(patches, 0, "HTTP enqueue must not send RSVP or notifications");
          return receipt;
        };
        if (["disabled", "wrong-user", "wrong-scope", "viewer", "revision-race", "role-race", "mapping-race", "native-state-race", "native-time-race"].includes(scenario)) {
          await assert.rejects(send);
          assert.equal((await db.select().from(eventOutbox).where(eq(eventOutbox.eventID, original.id))).length, 0);
          if (["disabled", "wrong-user", "wrong-scope", "viewer"].includes(scenario)) assert.equal(http, previousHttp);
        } else {
          const receipts = scenario === "concurrent" ? await Promise.all([send(), send()]) : [await send()];
          assert.equal(new Set(receipts.map(item => item.operationID)).size, 1);
          const [row] = await db.select().from(eventOutbox).where(eq(eventOutbox.eventID, original.id));
          assert.ok(row!.payload.rsvp); assert.deepEqual(row!.payload.rsvp!.baseline, remote);
          assert.equal(row!.payload.rsvp!.desiredState.ownResponse, "accepted");
          assert.equal(row!.payload.rsvp!.baselineState.ownResponse, "needsAction");
          assert.equal(row!.externalCalendarLinkID, link!.id);
          assert.deepEqual(await getEventSnapshot(original.id), original);
          assert.deepEqual(await getOwnProviderEventObservation(owner, original.id), observation);
          const publicDelivery = JSON.stringify(await getEventDeliveryStatus(owner, original.id));
          for (const privateValue of ["Private attendee comment", "Private baseline", "guest@example.test", "https://meet.example.test/private"]) assert.ok(!publicDelivery.includes(privateValue));
          if (scenario === "queue") {
            assert.equal((await post({ ...request, response: "declined" })).status, 400);
          }
          const previousReads = reads;
          assert.equal((await send()).replayed, true); assert.equal(reads, previousReads);
          await assert.rejects(() => queueGoogleRsvp(owner, original.id, { ...request, response: "declined" }));
          async function pull() {
            const fetched = await googleAdapter.fetchChanges(owner, "fixture", "guest@example.test", "old");
            const change = fetched.changes[0]; assert.equal(change.kind, "event");
            if (change.kind !== "event") throw new Error("Expected event");
            const value = change.data;
            assert.equal(value.timeModel, undefined); assert.ok(value.reminderTimeEvidence, "RSVP-only flag must retain temporal evidence without adopting canonical time");
            await upsertExternalEvent("google", owner, calendar.id, "guest@example.test", remote.id, { title: value.title, color: original.color, start: value.start, end: value.end, isAllDay: value.isAllDay, description: value.description, location: value.location, organizer: value.organizer ?? "", recurrence: value.recurrence, url: value.url }, value.etag, null, undefined, undefined, undefined, value.providerState, value.reminderTimeEvidence);
          }
          if (scenario === "worker-disabled") config.api.providerRsvpEditsEnabled = false;
          if (scenario === "lost" || scenario === "applied-503") mode = scenario;
          if (scenario === "worker-role-race") beforeRead = async () => { await db.update(calendarMembers).set({ role: "viewer" }).where(member); };
          if (scenario === "pull-baseline") beforeRead = pull;
          const adapter = { ...googleAdapter, async writeRsvp(...args: Parameters<NonNullable<typeof googleAdapter.writeRsvp>>) {
            const result = await googleAdapter.writeRsvp!(...args);
            if (scenario === "queue") {
              const [claimed] = await db.select().from(eventOutbox).where(eq(eventOutbox.id, row!.id));
              assert.equal(await completeEventOutbox(row!.id, claimed!.leaseToken!, { externalEventId: remote.id, etag: remote.etag }, { externalEventId: remote.id, etag: row!.expectedEtag }, { isEcho: true, externalEventId: remote.id, etag: remote.etag, deleted: false, providerState: row!.payload.rsvp!.desiredState, observedAt: new Date().toISOString() }), undefined, "Generic ACK cannot confirm a native RSVP");
            }
            if (scenario === "ack-role-race") await db.update(calendarMembers).set({ role: "viewer" }).where(member);
            if (scenario === "lease-race") await db.update(eventOutbox).set({ leaseToken: randomUUID(), leaseUntil: new Date(Date.now() + 60000) }).where(eq(eventOutbox.id, row!.id));
            if (scenario.includes("pull-") && scenario !== "pull-baseline") {
              if (scenario === "pull-native-comment-conflict") remote.attendees[0].comment = "Concurrent native comment";
              if (scenario === "pull-state-conflict") remote.attendees[1].responseStatus = "declined";
              if (scenario.endsWith("pull-zone-conflict")) { remote.start.timeZone = "Europe/Berlin"; remote.end.timeZone = "Europe/Berlin"; }
              if (scenario !== "pull-echo") remote.etag = '\"concurrent\"';
              await pull();
            }
            return result;
          } };
          let result = await deliverEventOutbox(row!.id, () => adapter);
          if (["lost", "applied-503"].includes(scenario)) {
            assert.equal(result!.status, "unconfirmed"); assert.equal(patches, 1);
            mode = "normal"; await db.update(eventOutbox).set({ nextAttemptAt: new Date(0) }).where(eq(eventOutbox.id, row!.id));
            result = await deliverEventOutbox(row!.id, () => googleAdapter);
          }
          if (scenario === "lease-race") {
            assert.equal(result!.status, "attempting");
            assert.equal((await db.select().from(externalEvents).where(eq(externalEvents.id, mapping!.id)))[0]!.etag, '\"v1\"');
            await db.update(eventOutbox).set({ leaseUntil: new Date(0), nextAttemptAt: new Date(0) }).where(eq(eventOutbox.id, row!.id));
            result = await deliverEventOutbox(row!.id, () => googleAdapter);
          }
          const status = scenario === "worker-disabled" ? "blocked" : scenario === "ack-role-race" ? "unconfirmed" : ["worker-role-race", "pull-state-conflict", "pull-zone-conflict", "legacy-pull-zone-conflict", "pull-native-comment-conflict"].includes(scenario) ? "conflict" : "completed";
          assert.equal(result!.status, status);
          if (scenario === "queue") {
            const beforeReplay = http;
            const completed = await post(request);
            assert.equal(completed.status, 202);
            assert.deepEqual(ProviderRsvpReceiptSchema.parse(await completed.json()), { operationID: row!.id, replayed: true, status: "completed", localCommitted: true, notificationDelivery: "unknown" });
            assert.equal(http, beforeReplay, "Completed HTTP replay must not resend or re-read provider data");
          }
          if (scenario === "pull-native-comment-conflict") { assert.equal(result!.remoteSnapshot?.etag, '"concurrent"'); assert.equal(result!.remoteSnapshot?.isEcho, false); }
          assert.equal(patches, ["worker-disabled", "worker-role-race"].includes(scenario) ? 0 : 1);
          const finalObservation = await getOwnProviderEventObservation(owner, original.id);
          assert.equal(finalObservation.state?.ownResponse, status === "completed" ? "accepted" : "needsAction");
          assert.deepEqual(await getEventSnapshot(original.id), original);
          assert.equal((await db.select().from(externalEvents).where(eq(externalEvents.id, mapping!.id)))[0]!.etag, status === "completed" ? '\"v2\"' : '\"v1\"');
        }
      } finally { beforeRead = undefined; await db.delete(user).where(eq(user.id, owner)); }
    }
    console.log("RSVP prepare/commit HTTP+DB: private intent, replay, OAuth/source/CAS races, unchanged event, conditional worker, recovery, lease/permission fencing and RSVP-only pending pull: OK");
  } finally { config.api.providerRsvpEditsEnabled = oldFlag; config.api.eventTimeEditsEnabled = oldTimeFlag; config.api.providerReminderEditsEnabled = oldReminderFlag; globalThis.fetch = realFetch; await new Promise<void>(resolve => api.close(() => resolve())); await new Promise<void>(resolve => server.close(() => resolve())); await db.$client.end(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
