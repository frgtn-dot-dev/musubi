import express from "express";
import { requireAuth } from "../middleware/require_auth";
import { middlewareErrorHandler } from "../middleware/error_handler";
import { issueMemberToken } from "../federation_tokens";
import { handlerGetEventDeliveryConflict, handlerResolveEventDelivery } from "../handlers/event_delivery";
import { CLIENT_VERSION_HEADER, PRODUCT_VERSION, EventDeliverySchema, EventDeliveryConflictSchema } from "@musubi/types";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { config } from "@musubi/config";
import { EventSchema } from "@musubi/types";
import { resolveEventTimeEdit } from "@musubi/calendar";
import { account, db, user, events, eventOutbox, externalEvents, externalCalendars, calendarMembers, externalEventTombstones, importExternalCalendar, queueGraphSeriesCreate, claimEventOutbox, adoptGraphCreatedFamily, graphCreateAdoptionVersion, graphCreateAdoptionReplay, assertNoPendingGraphSeriesCreate, readGraphSeriesCreateReceipt, requestEventDeliveryRetry, readGraphFamilyContext, replaceGraphFamily, findGraphSeriesCreateReplay, replaceMemberToken } from "@musubi/db";
import { prepareGraphCreateAdoption } from "./graph_create_adoption";
import { graphAdoptionFixture } from "./adapters/microsoft_create_adoption.fixture";
import { microsoftAdapter } from "./adapters/microsoft";
import { deliverEventOutbox } from "./event_delivery";
async function main() {
  assert.equal(process.env.ENVIRONMENT, "test");
  const oldFlag = config.api.eventTimeEditsEnabled;
  const app = express(); app.use(express.json());
  app.get("/events/:eventId/delivery/:operationId/conflict", requireAuth, handlerGetEventDeliveryConflict);
  app.post("/events/:eventId/delivery/:operationId/resolve", requireAuth, handlerResolveEventDelivery);
  app.use(middlewareErrorHandler);
  const api = app.listen(0, "127.0.0.1"); await new Promise<void>(resolve => api.once("listening", resolve));
  const address = api.address(); assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  try {
    for (const mode of ["public", "count", "until", "all-day", "flag", "absent", "duplicate", "meeting", "child-meeting", "no-end", "exception", "partial", "denied", "stale-native", "role-after", "revision-after", "source-after", "account-after", "history-after", "lease-after", "flag-after", "tombstone", "concurrent"]) {
      const actor = `graph-adoption-${randomUUID()}`;
      await db.insert(user).values({ id: actor, name: "Fixture", email: `${actor}@example.test`, isExternal: true });
      const credential = issueMemberToken(); await replaceMemberToken(actor, credential.tokenHash);
      const headers = { authorization: `Bearer ${credential.raw}`, "content-type": "application/json", [CLIENT_VERSION_HEADER]: PRODUCT_VERSION };
      const fixture = await graphAdoptionFixture(EventSchema.parse({ id: randomUUID(), creatorID: actor, organizer: "", isCanceled: false, calendars: [], title: "Provider title", color: "red", recurrence: "RRULE:FREQ=DAILY;COUNT=3", ...resolveEventTimeEdit({ kind: "zoned", timeZone: "Europe/Prague", startLocal: "2026-03-28T11:00:00", endLocal: "2026-03-28T12:00:00" }) }));
      try {
        config.api.eventTimeEditsEnabled = true;
        await db.insert(account).values({ id: randomUUID(), userId: actor, providerId: "microsoft", accountId: "fixture", scope: "Calendars.ReadWrite", refreshToken: "fixture", accessToken: "fixture", accessTokenExpiresAt: new Date(Date.now() + 3600000) });
        const calendar = await importExternalCalendar("microsoft", actor, "fixture", "Fixture", { externalId: "calendar", name: "Fixture", color: "red" });
        const [link] = await db.select().from(externalCalendars).where(eq(externalCalendars.calendarID, calendar.id));
        const saved = EventSchema.parse({ ...fixture.state.event, id: randomUUID(), revision: 1, organizer: actor, title: "Saved original title", originCalendarID: calendar.id, calendars: [calendar.id], recurrence: "RRULE:FREQ=DAILY;COUNT=4" });
        const queued = await queueGraphSeriesCreate(actor, randomUUID(), saved);
        await claimEventOutbox(queued.operationID);
        await db.update(eventOutbox).set({ status: "conflict", uncertain: true, leaseToken: null, leaseUntil: null, errorCode: "provider-conflict" }).where(eq(eventOutbox.id, queued.operationID));
        fixture.state.operationID = queued.operationID;
        if (mode === "until") fixture.state.event.recurrence = "RRULE:FREQ=DAILY;UNTIL=20260330T215959Z";
        if (mode === "all-day") fixture.state.event = { ...fixture.state.event, ...resolveEventTimeEdit({ kind: "all-day", startDate: "2026-03-28", endDate: "2026-03-29" }) };
        fixture.state.mode = mode;
        const journal = async () => (await db.select().from(eventOutbox).where(eq(eventOutbox.id, queued.operationID)))[0]!;
        const before = await journal();
        await assert.rejects(() => db.transaction(tx => assertNoPendingGraphSeriesCreate(tx, calendar.id)));
        const prepare = () => prepareGraphCreateAdoption(actor, saved.id, queued.operationID);
        if (mode === "flag") { config.api.eventTimeEditsEnabled = false; assert.equal(await prepare(), null); assert.equal(fixture.state.reads, 0); continue; }
        if (["absent", "duplicate", "meeting", "child-meeting", "no-end", "exception", "partial", "denied"].includes(mode)) { await assert.rejects(prepare); assert.equal(fixture.state.writes, 0); continue; }
        const endpoint = `${origin}/events/${saved.id}/delivery/${queued.operationID}`;
        if (mode === "public") {
          const denied = await fixture.originalFetch(`${endpoint}/conflict`); assert.equal(denied.status, 401); assert.equal(fixture.state.reads, 0);
          const preview = await fixture.originalFetch(`${endpoint}/conflict`, { headers }); assert.equal(preview.status, 200);
          assert.ok(EventDeliveryConflictSchema.parse(await preview.json()).graphCreateAdoption);
        }
        const prepared = await prepare(); assert.ok(prepared);
        const oldContext = structuredClone(prepared.context);
        delete (oldContext.event as Partial<typeof oldContext.event>).providerReadRetiredRevision;
        assert.equal(graphCreateAdoptionVersion(oldContext, prepared.observation), graphCreateAdoptionVersion(prepared.context, prepared.observation), "Pre-0075 absent provenance preserves exact adoption fingerprint");
        assert.equal(prepared.preview.local!.title, saved.title); assert.equal(prepared.preview.remote!.title, "Provider title");
        const request = { kind: "graph-create-adoption" as const, mutationID: randomUUID(), expectedRevision: saved.revision!, stateVersion: prepared.preview.graphCreateAdoption!.stateVersion };
        if (mode === "stale-native") { fixture.state.event.title = "Changed again"; const refreshed = await prepare(); assert.ok(refreshed); await assert.rejects(() => adoptGraphCreatedFamily(refreshed.context, refreshed.observation, request)); continue; }
        if (mode === "role-after") await db.update(calendarMembers).set({ role: "viewer" }).where(eq(calendarMembers.calendarID, calendar.id));
        if (mode === "revision-after") await db.update(events).set({ revision: 2 }).where(eq(events.id, saved.id));
        if (mode === "source-after") await db.update(externalCalendars).set({ disabled: true }).where(eq(externalCalendars.id, link!.id));
        if (mode === "account-after") await db.delete(account).where(eq(account.userId, actor));
        if (mode === "history-after") await db.insert(eventOutbox).values({ ...before, id: randomUUID(), mutationID: randomUUID(), revision: 2, predecessorID: before.id, status: "pending" });
        if (mode === "lease-after") await db.update(eventOutbox).set({ status: "attempting", leaseToken: randomUUID(), leaseUntil: new Date(Date.now() + 60000) }).where(eq(eventOutbox.id, before.id));
        if (mode === "flag-after") config.api.eventTimeEditsEnabled = false;
        if (mode === "tombstone") await db.insert(externalEventTombstones).values({ externalCalendarLinkID: link!.id, externalEventID: "master" });
        const commit = () => adoptGraphCreatedFamily(prepared.context, prepared.observation, request);
        if (["role-after", "revision-after", "source-after", "account-after", "history-after", "lease-after", "flag-after", "tombstone"].includes(mode)) { await assert.rejects(commit); assert.equal((await db.select().from(externalEvents).where(eq(externalEvents.calendarID, calendar.id))).length, 0); continue; }
        if (mode === "concurrent") { const results = await Promise.allSettled([commit(), commit()]); assert.equal(results.filter(value => value.status === "fulfilled").length, 1); } else if (mode === "public") {
          const response = await fixture.originalFetch(`${endpoint}/resolve`, { method: "POST", headers, body: JSON.stringify(request) });
          assert.equal(response.status, 200); assert.equal(EventDeliverySchema.parse(await response.json()).targets[0]!.graphCreateAdopted, true);
          const reads = fixture.state.reads;
          const replay = await fixture.originalFetch(`${endpoint}/resolve`, { method: "POST", headers, body: JSON.stringify(request) });
          assert.equal(replay.status, 200); assert.equal(fixture.state.reads, reads);
        } else await commit();
        const after = await journal(); assert.equal(after.status, "not-needed");
        const { graphCreateAdoption, ...unchanged } = after.payload; assert.deepEqual(unchanged, before.payload); assert.ok(graphCreateAdoption);
        assert.equal(await graphCreateAdoptionReplay(actor, saved.id, queued.operationID, request), true);
        await assert.rejects(() => graphCreateAdoptionReplay(actor, saved.id, queued.operationID, { ...request, stateVersion: "0".repeat(64) }));
        const receipt = await readGraphSeriesCreateReceipt(actor, queued.operationID); assert.equal(receipt.kind, "active"); if (receipt.kind === "active") assert.equal(receipt.event.title, "Provider title");
        const currentFamily = await readGraphFamilyContext({ userID: actor, accountID: "fixture", calendarID: calendar.id, externalMasterID: "master" });
        assert.equal((await replaceGraphFamily(currentFamily, prepared.observation)).changed, false);
        assert.equal((await findGraphSeriesCreateReplay(actor, before.mutationID, saved))!.operationID, before.id);
        await db.transaction(tx => assertNoPendingGraphSeriesCreate(tx, calendar.id));
        assert.equal(await requestEventDeliveryRetry(actor, saved.id, queued.operationID), queued.operationID);
        assert.equal((await journal()).status, "not-needed");
        await deliverEventOutbox(queued.operationID, () => microsoftAdapter); assert.equal(fixture.state.writes, 0);
        assert.equal((await db.select().from(externalEvents).where(eq(externalEvents.calendarID, calendar.id))).length, 4);
        console.log(`Graph create adoption ${mode}: atomic family, immutable intent, no writes and no resurrection: OK`);
      } finally { await fixture.close(); await db.delete(user).where(eq(user.id, actor)); }
    }
  } finally { config.api.eventTimeEditsEnabled = oldFlag; api.closeAllConnections(); await new Promise<void>(resolve => api.close(() => resolve())); }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
