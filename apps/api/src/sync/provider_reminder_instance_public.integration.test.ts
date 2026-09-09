import express from "express";
import { account, replaceMemberToken } from "@musubi/db";
import { CLIENT_VERSION_HEADER, PRODUCT_VERSION, ProviderReminderReceiptSchema } from "@musubi/types";
import { issueMemberToken } from "../federation_tokens";
import { requireAuth } from "../middleware/require_auth";
import { middlewareErrorHandler } from "../middleware/error_handler";
import { handlerGetProviderEventState, handlerProviderReminderEdit } from "../handlers/events";
import { createServer } from "node:http";
import { config } from "@musubi/config";
import { googleAdapter } from "./adapters/google";
import { deliverEventOutbox } from "./event_delivery";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, user, events, externalEvents, externalCalendars, eventOutbox, createCalendar, upsertExternalEvent, getEventSnapshot, providerStateVersion } from "@musubi/db";
import { googleEventState } from "./adapters/provider_event_state";
import type { EventTimeModel } from "@musubi/types";

async function main() {
  assert.equal(process.env.ENVIRONMENT, "test");
  const savedFlag = config.api.providerReminderEditsEnabled;
  config.api.providerReminderEditsEnabled = true;
  let reads = 0;
  let remote: any, mode = "normal", patches = 0, expectedPatchEtag = '"child"';
  let onRead: (() => Promise<void>) | undefined, onPatch: (() => Promise<void>) | undefined;
  const fixture = createServer(async (req, res) => {
    try {
      assert.equal(req.headers.authorization, "Bearer synthetic-instance-reminder");
      res.setHeader("content-type", "application/json");
      if (req.url === "/calendar/v3/users/me/calendarList/primary") { res.end(JSON.stringify({ id: "guest@example.test", primary: true, accessRole: "owner" })); return; }
      assert.ok(req.url?.startsWith("/calendar/v3/calendars/guest%40example.test/events/instance"));
      if (req.method === "GET") {
        reads++;
        if (onRead) { const action = onRead; onRead = undefined; await action(); }
        res.end(JSON.stringify(remote)); return;
      }
      assert.equal(req.method, "PATCH");
      assert.equal(req.url, "/calendar/v3/calendars/guest%40example.test/events/instance?sendUpdates=none");
      assert.equal(req.headers["if-match"], expectedPatchEtag);
      let body = ""; for await (const chunk of req) body += chunk;
      assert.deepEqual(JSON.parse(body), { reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 15 }] } });
      patches++;
      if (remote.etag !== req.headers["if-match"]) { res.writeHead(412); res.end(); return; }
      remote.reminders = { useDefault: false, overrides: [{ method: "popup", minutes: 15 }] }; remote.etag = '\"child-next\"';
      if (onPatch) { const action = onPatch; onPatch = undefined; await action(); }
      if (mode === "lost") { req.socket.destroy(); return; }
      if (mode === "503") { res.writeHead(503); res.end(); return; }
      res.end(JSON.stringify(remote));
    } catch (error) { res.statusCode = 500; res.end(JSON.stringify({ error: String(error) })); }
  });
  await new Promise<void>(resolve => fixture.listen(0, "127.0.0.1", resolve));
  const address = fixture.address(); assert.ok(address && typeof address !== "string");
  const realFetch = globalThis.fetch;
  const app = express(); app.use(express.json());
  app.get("/api/v1/events/:eventId/provider-state", requireAuth, handlerGetProviderEventState);
  app.post("/api/v1/events/:eventId/provider-reminders", requireAuth, handlerProviderReminderEdit);
  app.use(middlewareErrorHandler);
  const api = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => api.once("listening", resolve));
  const apiAddress = api.address(); assert.ok(apiAddress && typeof apiAddress !== "string");
  const apiOrigin = `http://127.0.0.1:${apiAddress.port}`;
  globalThis.fetch = (input, init) => { const url = new URL(String(input)); assert.equal(url.origin, "https://www.googleapis.com"); return realFetch(`http://127.0.0.1:${address.port}${url.pathname}${url.search}`, init); };
  try {
  for (const kind of ["zoned", "all-day"] as const) {
    for (const scenario of ["public-queue", "public-concurrent", "public-parent-race", "public-native-parent", "public-native-original"]) {
      mode = "normal"; patches = 0; reads = 0; expectedPatchEtag = '"child"'; onRead = undefined; onPatch = undefined;
      const owner = `reminder-worker-${randomUUID()}`;
      await db.insert(user).values({ id: owner, name: owner, email: `${owner}@example.test`, isExternal: true });
      try {
        const calendar = await createCalendar({ creatorID: owner, name: "Instance fixture", color: "red" });
        await db.insert(externalCalendars).values({ provider: "google", userID: owner, accountID: "fixture", calendarID: calendar.id, externalCalendarID: "guest@example.test" }).returning();
        const allDay = kind === "all-day";
        const originalStart = allDay ? { kind: "date" as const, value: "2026-10-25" } : { kind: "instant" as const, value: "2026-10-25T00:30:00.000Z" };
        const model: EventTimeModel = allDay ? { kind: "all-day" } : { kind: "zoned", timeZone: "Europe/Prague", startLocal: "2026-10-25T04:30:00.000", endLocal: "2026-10-25T05:30:00.000" };
        const native = { id: "instance", etag: '"child"', status: "confirmed", summary: "Moved meeting", start: allDay ? { date: "2026-10-26" } : { dateTime: "2026-10-25T04:30:00+01:00", timeZone: "Europe/Prague" }, end: allDay ? { date: "2026-10-27" } : { dateTime: "2026-10-25T05:30:00+01:00", timeZone: "Europe/Prague" }, recurringEventId: "series", originalStartTime: allDay ? { date: originalStart.value } : { dateTime: "2026-10-25T02:30:00+02:00", timeZone: "Europe/Prague" }, organizer: { email: "host@example.test" }, reminders: { useDefault: false, overrides: [{ method: "email", minutes: 30 }] }, extendedProperties: { private: { untouched: "private fixture" } }, attendees: [{ email: "guest@example.test", self: true, responseStatus: "needsAction" }, { email: "other@example.test", responseStatus: "accepted" }] };
        remote = structuredClone(native);
        const state = googleEventState(native);
        const values = { title: native.summary, color: "red", start: new Date(allDay ? "2026-10-26T00:00:00Z" : "2026-10-25T03:30:00Z"), end: new Date(allDay ? "2026-10-26T00:00:00Z" : "2026-10-25T04:30:00Z"), isAllDay: allDay, description: null, location: null, organizer: "host@example.test", recurrence: null, url: null };
        const parentModel: EventTimeModel = allDay ? { kind: "all-day" } : { kind: "zoned", timeZone: "Europe/Prague", startLocal: "2026-10-24T02:30:00.000", endLocal: "2026-10-24T03:30:00.000" };
        await upsertExternalEvent("google", owner, calendar.id, "guest@example.test", "series", { ...values, title: "Series", start: new Date(allDay ? "2026-10-24T00:00:00Z" : "2026-10-24T00:30:00Z"), end: new Date(allDay ? "2026-10-24T00:00:00Z" : "2026-10-24T01:30:00Z"), recurrence: "RRULE:FREQ=DAILY;COUNT=4" }, '"parent"', null, undefined, { timeModel: parentModel }, undefined, state);
        await upsertExternalEvent("google", owner, calendar.id, "guest@example.test", "instance", values, native.etag, null, undefined, { timeModel: model, externalSeriesID: "series", originalStart }, undefined, state);
        const maps = await db.select().from(externalEvents).where(eq(externalEvents.calendarID, calendar.id)).orderBy(externalEvents.id);
        const mapping = maps.find(item => item.externalEventID === "instance")!;
        const parentMapping = maps.find(item => item.externalEventID === "series")!;
        const child = (await getEventSnapshot(mapping.eventID))!;
        const parent = (await getEventSnapshot(parentMapping.eventID))!;
        const request = { provider: "google", operationID: randomUUID(), expectedRevision: child.revision, expectedStateVersion: providerStateVersion(mapping), reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 15 }] } };
          await db.insert(account).values({ id: randomUUID(), userId: owner, providerId: "google", accountId: "fixture", scope: "https://www.googleapis.com/auth/calendar.events", accessToken: "synthetic-instance-reminder", refreshToken: "synthetic-refresh", accessTokenExpiresAt: new Date(Date.now() + 3600000) });
          const credential = issueMemberToken(); await replaceMemberToken(owner, credential.tokenHash);
          const headers = { authorization: `Bearer ${credential.raw}`, [CLIENT_VERSION_HEADER]: PRODUCT_VERSION, "Content-Type": "application/json" };
          const post = (body: unknown, id = child.id) => realFetch(`${apiOrigin}/api/v1/events/${id}/provider-reminders`, { method: "POST", headers, body: JSON.stringify(body) });
          assert.equal((await realFetch(`${apiOrigin}/api/v1/events/${child.id}/provider-reminders`, { method: "POST", headers: { "Content-Type": "application/json", [CLIENT_VERSION_HEADER]: PRODUCT_VERSION }, body: JSON.stringify(request) })).status, 401);
          assert.equal((await post({ ...request, occurrence: { externalSeriesID: "forged" } })).status, 400);
          assert.equal((await post(request, parent.id)).status, 403, "Series master remains unsupported");
          config.api.providerReminderEditsEnabled = false;
          const disabled = await realFetch(`${apiOrigin}/api/v1/events/${child.id}/provider-state`, { headers });
          assert.equal(disabled.status, 200); assert.equal((await disabled.json()).reminderEdit, undefined);
          assert.equal((await post(request)).status, 403);
          config.api.providerReminderEditsEnabled = true;
          const fresh = await realFetch(`${apiOrigin}/api/v1/events/${child.id}/provider-state`, { headers });
          assert.equal(fresh.headers.get("cache-control"), "private, no-store");
          assert.deepEqual((await fresh.json()).reminderEdit, { provider: "google", expectedRevision: child.revision });
          if (scenario === "public-parent-race") onRead = async () => { await db.update(events).set({ revision: parent.revision + 1 }).where(eq(events.id, parent.id)); };
          if (scenario === "public-native-parent") remote.recurringEventId = "other";
          if (scenario === "public-native-original") remote.originalStartTime = allDay ? { date: "2026-10-26" } : { dateTime: "2026-10-25T02:30:00+01:00" };
          const replies = scenario === "public-concurrent" ? await Promise.all([post(request), post(request)]) : [await post(request)];
          assert.equal(patches, 0, "Public enqueue never PATCHes or notifies inline");
          if (["public-parent-race", "public-native-parent", "public-native-original"].includes(scenario)) {
            assert.equal(replies[0]!.status, scenario === "public-parent-race" ? 400 : 403);
            assert.equal((await db.select().from(eventOutbox).where(eq(eventOutbox.eventID, child.id))).length, 0);
          } else {
            const receipts = await Promise.all(replies.map(async response => { assert.equal(response.status, 202); assert.equal(response.headers.get("cache-control"), "private, no-store"); return ProviderReminderReceiptSchema.parse(await response.json()); }));
            assert.equal(new Set(receipts.map(item => item.operationID)).size, 1);
            assert.equal((await db.select().from(eventOutbox).where(eq(eventOutbox.eventID, child.id))).length, 1);
            const receipt = receipts[0]!;
            const beforeReplay = reads;
            const replay = ProviderReminderReceiptSchema.parse(await (await post(request)).json());
            assert.equal(reads, beforeReplay, "Exact replay does not refetch native evidence"); assert.equal(replay.replayed, true); assert.equal(replay.operationID, receipt.operationID);
            assert.deepEqual(await getEventSnapshot(child.id), child);
            assert.equal((await deliverEventOutbox(receipt.operationID, () => googleAdapter))?.status, "completed");
            assert.equal(patches, 1); assert.deepEqual(remote.reminders, request.reminders);
            assert.deepEqual(await getEventSnapshot(child.id), child);
          }
      } finally { await db.delete(user).where(eq(user.id, owner)); }
    }
  }
  } finally { config.api.providerReminderEditsEnabled = savedFlag; globalThis.fetch = realFetch; await new Promise<void>(resolve => api.close(() => resolve())); await new Promise<void>(resolve => fixture.close(() => resolve())); }
  console.log("Google instance reminder HTTP admission: own source, flag/auth/strict DTO, bound native preflight, concurrent replay, parent/native refusal and durable delivery: OK");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
