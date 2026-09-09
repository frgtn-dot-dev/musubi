import express from "express";
import { requireAuth } from "../middleware/require_auth";
import { middlewareErrorHandler } from "../middleware/error_handler";
import { handlerRetryEventDelivery } from "../handlers/event_delivery";
import { verifyGraphDispatchLocks } from "./microsoft_rsvp_lock.fixture";
import { eventDeliveryActions } from "@musubi/calendar";
import { handlerGetProviderEventState, handlerProviderRsvpEdit } from "../handlers/events";
import { issueMemberToken } from "../federation_tokens";
import { CLIENT_VERSION_HEADER, PRODUCT_VERSION, ProviderEventStateResponseSchema, ProviderRsvpReceiptSchema } from "@musubi/types";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { config } from "@musubi/config";
import { db, user, account, externalEvents, externalCalendars, eventOutbox, events, calendarMembers, importExternalCalendar, upsertExternalEvent, getOwnProviderEventObservation, getEventSnapshot, getEventDeliveryStatus, claimEventOutbox, markGraphRsvpDispatched, replaceMemberToken, deleteExternalEvent } from "@musubi/db";
import { graphRsvpFixture } from "./adapters/microsoft_rsvp.fixture";
import { microsoftAdapter, toNormalized } from "./adapters/microsoft";
import { queueProviderRsvp } from "./provider_rsvp";
import { deliverEventOutbox } from "./event_delivery";
async function main() {
  assert.equal(process.env.ENVIRONMENT, "test");
  const flag = config.api.providerRsvpEditsEnabled;
  const app = express(); app.use(express.json());
  app.get("/events/:eventId/provider-state", requireAuth, handlerGetProviderEventState);
  app.post("/events/:eventId/delivery/:operationId/retry", requireAuth, handlerRetryEventDelivery);
  app.post("/events/:eventId/provider-rsvp", requireAuth, handlerProviderRsvpEdit); app.use(middlewareErrorHandler);
  const api = app.listen(0, "127.0.0.1"); await new Promise<void>(resolve => api.once("listening", resolve));
  const address = api.address(); assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  try {
    for (const scenario of ["mark-lock-role", "mark-lock-revision", "mark-lock-source", "mark-lock-account", "whitespace", "uid-backfill", "decline-pull-before-ack", "all-day", "echo-dst", "public", "accepted", "tentative", "declined", "no-op", "lost", "not-observed", "decline-absent", "changed", "before-network-restart", "echo-before-ack", "flag", "worker-flag", "account-after-read", "role-after-read", "revision-after-read", "lease-after-read"] as const) {
      const actor = `graph-rsvp-${randomUUID()}`;
      const fixture = await graphRsvpFixture();
      await db.insert(user).values({ id: actor, name: "Fixture", email: `${actor}@example.test`, isExternal: true });
      try {
        config.api.providerRsvpEditsEnabled = true;
        await db.insert(account).values({ id: randomUUID(), userId: actor, providerId: "microsoft", accountId: "account", scope: "Calendars.ReadWrite", refreshToken: "fixture", accessToken: "fixture", accessTokenExpiresAt: new Date(Date.now() + 3600000) });
        const calendar = await importExternalCalendar("microsoft", actor, "account", "Fixture", { externalId: "calendar", name: "Fixture", color: "red" });
        if (scenario === "whitespace") { fixture.state.native.body.content = " Keep details\r\n"; fixture.state.native.location.displayName = " Room  "; }
        if (scenario === "all-day") { fixture.state.native.isAllDay = true; fixture.state.native.start.dateTime = "2026-03-28T00:00:00"; fixture.state.native.end.dateTime = "2026-03-30T00:00:00"; }
        if (scenario === "echo-dst") { fixture.state.native.start.dateTime = "2026-03-28T08:00:00"; fixture.state.native.end.dateTime = "2026-03-29T08:00:00"; }
        if (scenario === "no-op") { fixture.state.native.responseStatus.response = "accepted"; fixture.state.native.attendees[0]!.status.response = "accepted"; }
        const persist = async () => { const native = toNormalized(fixture.state.native); return upsertExternalEvent("microsoft", actor, calendar.id, "calendar", "meeting", { title: native.title, start: native.start, end: native.end, isAllDay: native.isAllDay, description: native.description, location: native.location, organizer: native.organizer ?? "", recurrence: null, url: null, color: "red" }, native.etag, native.icalUid, undefined, undefined, undefined, native.providerState, native.reminderTimeEvidence); };
        await persist();
        const [mapping] = await db.select().from(externalEvents).where(eq(externalEvents.calendarID, calendar.id)); assert.ok(mapping);
        const original = (await getEventSnapshot(mapping.eventID))!;
        if (scenario === "uid-backfill") {
          await db.update(externalEvents).set({ icalUid: null }).where(eq(externalEvents.id, mapping.id));
          const originalMaps = (await db.select().from(externalEvents).where(eq(externalEvents.id, mapping.id)))[0]!;
          assert.equal(await persist(), false);
          const enriched = (await db.select().from(externalEvents).where(eq(externalEvents.id, mapping.id)))[0]!;
          assert.equal(enriched.icalUid, "meeting-uid");
          assert.deepEqual({ ...enriched, icalUid: null, updatedAt: originalMaps.updatedAt }, originalMaps);
          assert.deepEqual(await getEventSnapshot(original.id), original);
          assert.equal((await db.select().from(eventOutbox).where(eq(eventOutbox.eventID, original.id))).length, 0);
        }
        const observation = await getOwnProviderEventObservation(actor, original.id);
        const response = scenario === "tentative" ? "tentative" : scenario === "declined" || (scenario === "decline-absent" || scenario === "decline-pull-before-ack") ? "declined" : "accepted";
        const request = { operationID: randomUUID(), provider: "microsoft", expectedRevision: original.revision, expectedStateVersion: observation.version!, response, notificationPolicy: "send-response" };
        if (scenario === "flag") { config.api.providerRsvpEditsEnabled = false; await assert.rejects(() => queueProviderRsvp(actor, original.id, request)); assert.equal(fixture.state.reads, 0); continue; }
        const credential = issueMemberToken(); await replaceMemberToken(actor, credential.tokenHash);
        const headers = { authorization: `Bearer ${credential.raw}`, "content-type": "application/json", [CLIENT_VERSION_HEADER]: PRODUCT_VERSION };
        const endpoint = `${origin}/events/${original.id}`;
        if (scenario === "public") {
          assert.equal((await fixture.originalFetch(`${endpoint}/provider-state`)).status, 401);
          assert.equal(fixture.state.reads, 0);
          const publicState = await fixture.originalFetch(`${endpoint}/provider-state`, { headers }); assert.equal(publicState.status, 200);
          assert.equal(ProviderEventStateResponseSchema.parse(await publicState.json()).rsvpEdit?.provider, "microsoft");
        }
        const queued = scenario === "public" ? await (async () => { const result = await fixture.originalFetch(`${endpoint}/provider-rsvp`, { method: "POST", headers, body: JSON.stringify(request) }); assert.equal(result.status, 202); return ProviderRsvpReceiptSchema.parse(await result.json()); })() : await queueProviderRsvp(actor, original.id, request);
        assert.equal(fixture.state.posts, 0);
        const row = async () => (await db.select().from(eventOutbox).where(eq(eventOutbox.id, queued.operationID)))[0]!;
        const before = await row();
        if (scenario.startsWith("mark-lock-")) {
          const claimed = (await claimEventOutbox(queued.operationID))!;
          await verifyGraphDispatchLocks(claimed, tx => scenario === "mark-lock-role" ? tx.update(calendarMembers).set({ role: "viewer" }).where(eq(calendarMembers.calendarID, calendar.id)) : scenario === "mark-lock-revision" ? tx.update(events).set({ revision: original.revision! + 1 }).where(eq(events.id, original.id)) : scenario === "mark-lock-source" ? tx.update(externalCalendars).set({ disabled: true }).where(eq(externalCalendars.calendarID, calendar.id)) : tx.update(account).set({ syncStatus: "reconnect-required" }).where(eq(account.userId, actor)));
          assert.equal(fixture.state.posts, 0); console.log(`Graph RSVP DB ${scenario}: OK`); continue;
        }
        const deliver = () => deliverEventOutbox(queued.operationID, () => microsoftAdapter, { timeoutMs: 5000 });
        fixture.state.mode = scenario;
        // Fake server also verifies the actual persisted marker before POST.
        fixture.state.hook = async () => { fixture.state.marked = !!(await row()).payload.rsvp?.graphDispatch; };
        if (scenario.endsWith("after-read")) fixture.state.hook = async () => {
          fixture.state.hook = undefined;
          if (scenario === "account-after-read") await db.update(account).set({ syncStatus: "reconnect-required" }).where(eq(account.userId, actor));
          if (scenario === "role-after-read") await db.update(calendarMembers).set({ role: "viewer" }).where(eq(calendarMembers.calendarID, calendar.id));
          if (scenario === "revision-after-read") await db.update(events).set({ revision: original.revision! + 1 }).where(eq(events.id, original.id));
          if (scenario === "lease-after-read") await db.update(eventOutbox).set({ leaseUntil: new Date(0) }).where(eq(eventOutbox.id, queued.operationID));
        };
        if (scenario === "before-network-restart") {
          const claimed = (await claimEventOutbox(queued.operationID))!;
          assert.equal(await markGraphRsvpDispatched(claimed), true);
          await db.update(eventOutbox).set({ leaseUntil: new Date(0) }).where(eq(eventOutbox.id, queued.operationID));
        }
        if (scenario === "echo-before-ack" || scenario === "echo-dst") fixture.state.hook = async () => { if (fixture.state.posts) await persist(); };
        if (scenario === "decline-pull-before-ack") {
          fixture.state.mode = "decline-absent";
          fixture.state.hook = async () => { if (fixture.state.posts) { fixture.state.hook = undefined; await deleteExternalEvent("microsoft", calendar.id, "meeting"); } };
        }
        if (scenario === "worker-flag") config.api.providerRsvpEditsEnabled = false;
        // Server-side POST validation queries the journal at the moment of send.
        const fetch = globalThis.fetch;
        globalThis.fetch = async (input, init) => { if (init?.method === "POST") fixture.state.marked = !!(await row()).payload.rsvp?.graphDispatch; return fetch(input, init); };
        await deliver();
        const after = await row();
        if (scenario === "decline-pull-before-ack") {
          assert.equal(after.status, "conflict"); assert.equal(after.leaseToken, null);
          assert.equal(eventDeliveryActions((await getEventDeliveryStatus(actor, original.id)).targets[0]!).retry, true);
          const marker = after.payload.rsvp!.graphDispatch;
          const response = await fixture.originalFetch(`${endpoint}/delivery/${queued.operationID}/retry`, { method: "POST", headers, body: "{}" });
          assert.equal(response.status, 202);
          for (let i = 0; i < 200 && (await row()).errorCode !== "graph-rsvp-copy-absent"; i++) await new Promise(resolve => setTimeout(resolve, 10));
          const recovered = await row(); assert.equal(recovered.errorCode, "graph-rsvp-copy-absent");
          assert.equal(recovered.status, "unconfirmed"); assert.deepEqual(recovered.payload.rsvp!.graphDispatch, marker);
          assert.deepEqual(recovered.remoteSnapshot, after.remoteSnapshot); assert.equal(fixture.state.posts, 1);
          assert.equal((await getEventDeliveryStatus(actor, original.id)).targets[0]!.graphRsvpPhase, "absent");
          console.log(`Graph RSVP DB ${scenario}: OK`); continue;
        }
        if (["whitespace", "uid-backfill", "all-day", "echo-dst", "public", "accepted", "tentative", "declined", "no-op", "echo-before-ack"].includes(scenario)) { assert.equal(after.status, "completed", scenario); assert.equal((await getEventDeliveryStatus(actor, original.id)).targets[0]!.graphRsvpPhase, "observed"); }
        if (["lost", "not-observed", "decline-absent", "changed", "before-network-restart"].includes(scenario)) {
          assert.ok(after.payload.rsvp?.graphDispatch, scenario);
          const count = fixture.state.posts;
          await db.update(eventOutbox).set({ nextAttemptAt: new Date(0) }).where(eq(eventOutbox.id, queued.operationID));
          await deliver(); assert.equal(fixture.state.posts, count);
          if (scenario === "lost") assert.equal((await row()).status, "completed");
          if (scenario === "decline-absent") assert.equal((await getEventDeliveryStatus(actor, original.id)).targets[0]!.graphRsvpPhase, "absent");
        }
        if (scenario.endsWith("after-read") || scenario === "worker-flag" || scenario === "before-network-restart" || scenario === "no-op") assert.equal(fixture.state.posts, 0, scenario);
        assert.deepEqual((await row()).payload.rsvp!.baseline, before.payload.rsvp!.baseline);
        assert.deepEqual((await row()).payload.rsvp!.request, before.payload.rsvp!.request);
        if (scenario !== "worker-flag" && !scenario.endsWith("after-read")) assert.equal((await queueProviderRsvp(actor, original.id, request)).operationID, queued.operationID);
        console.log(`Graph RSVP DB ${scenario}: OK`);
      } finally { await fixture.close(); await db.delete(user).where(eq(user.id, actor)); }
    }
  } finally { config.api.providerRsvpEditsEnabled = flag; api.closeAllConnections(); await new Promise<void>(resolve => api.close(() => resolve())); }
}
void main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => process.exit());
