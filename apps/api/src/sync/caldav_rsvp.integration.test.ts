import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import express from "express";
import { eq, sql } from "drizzle-orm";
import { config } from "@musubi/config";
import { CLIENT_VERSION_HEADER, PRODUCT_VERSION, ProviderEventStateResponseSchema, ProviderRsvpReceiptSchema, CaldavRsvpDeliverySchema } from "@musubi/types";
import { db, user, caldavAccounts, events, eventOutbox, externalEvents, externalCalendars, calendarMembers, saveCaldavAccount, importExternalCalendar, replaceExternalEventResource, upsertExternalEvent, getEventSnapshot, getOwnProviderEventObservation, claimEventOutbox, completeEventOutbox, completeProviderRsvpOutbox, replaceMemberToken, markCaldavRsvpDispatched, requestEventDeliveryRetry, getEventDeliveryStatus } from "@musubi/db";
import { createCaldavRsvpFixture, caldavRsvpDstDurationData } from "./adapters/caldav_rsvp.fixture";
import { normalizeCaldavResource } from "./adapters/caldav_time";
import { caldavRsvpState } from "./adapters/caldav_rsvp";
import { caldavAdapter, normalizedObjectChanges } from "./adapters/caldav";
import { queueProviderRsvp } from "./provider_rsvp";
import { deliverEventOutbox } from "./event_delivery";
import { encryptSecret } from "./crypto";
import { issueMemberToken } from "../federation_tokens";
import { requireAuth } from "../middleware/require_auth";
import { middlewareErrorHandler } from "../middleware/error_handler";
import { handlerGetProviderEventState, handlerProviderRsvpEdit } from "../handlers/events";

async function main() {
  assert.equal(process.env.ENVIRONMENT, "test");
  for (const invalid of [null, {}, { kind: "caldav-rsvp-at-most-once", version: 2 }, { kind: "caldav-rsvp-at-most-once", version: 1, startedAt: "invalid" }, { kind: "caldav-rsvp-at-most-once", version: 1, cleared: true }]) assert.equal(CaldavRsvpDeliverySchema.safeParse(invalid).success, false);
  const flag = config.api.providerRsvpEditsEnabled, timeFlag = config.api.eventTimeEditsEnabled;
  config.api.eventTimeEditsEnabled = false;
  const app = express(); app.use(express.json());
  app.get("/events/:eventId/provider-state", requireAuth, handlerGetProviderEventState);
  app.post("/events/:eventId/provider-rsvp", requireAuth, handlerProviderRsvpEdit);
  app.use(middlewareErrorHandler);
  const api = app.listen(0, "127.0.0.1"); await new Promise<void>(resolve => api.once("listening", resolve));
  const port = api.address(); assert.ok(port && typeof port !== "string");
  const origin = `http://127.0.0.1:${port.port}`;
  try {
    for (const scenario of ["public", "all-day", "concurrent", "lost", "metadata", "no-op", "lowercase-no-op", "echo-before-ack", "echo-dst-duration", "OPTIONS-429", "PROPFIND-503", "disabled", "worker-disabled", "viewer", "role-after", "lease-after", "revision-after", "mapping-before", "source-before", "permission-before", "account-after-read", "changed-native", "forged-ack", "pending-pull", "marker-race", "marker-expired", "marker-payload", "marker-source", "marker-disconnected", "marker-flag", "marker-legacy", "marker-malformed", "marker-retry", "marker-crash", "marker-reclaim", "legacy-readonly", "legacy-recovered", "dispatch-412"]) {
      const fixture = await createCaldavRsvpFixture(), { state, collection, resource } = fixture;
      const actor = `caldav-rsvp-${randomUUID()}`, credential = issueMemberToken();
      await db.insert(user).values({ id: actor, name: "Fixture", email: `${actor}@example.test`, isExternal: true });
      await replaceMemberToken(actor, credential.tokenHash);
      const headers = { authorization: `Bearer ${credential.raw}`, "content-type": "application/json", [CLIENT_VERSION_HEADER]: PRODUCT_VERSION };
      try {
        const account = await saveCaldavAccount(actor, fixture.origin + "/", "fixture", encryptSecret("fixture"));
        const calendar = await importExternalCalendar("caldav", actor, account.id, "Fixture", { externalId: collection, name: "Fixture", color: "red", supportsEvents: true });
        if (scenario === "echo-dst-duration") state.data = caldavRsvpDstDurationData;
        if (scenario === "all-day") state.data = state.data.replace("DTSTART:20260328T090000Z", "DTSTART;VALUE=DATE:20260328").replace("DTEND:20260328T100000Z", "DTEND;VALUE=DATE:20260329");
        if (scenario === "no-op") state.data = state.data.replace("PARTSTAT=NEEDS-ACTION", "PARTSTAT=ACCEPTED");
        if (scenario === "lowercase-no-op") state.data = state.data.replace("PARTSTAT=NEEDS-ACTION", "PARTSTAT=accepted");
        const importEvents = () => {
          const changes = normalizedObjectChanges([{ url: resource, etag: state.etag, data: state.data }]);
          return changes.flatMap(change => change.kind === "event" ? [change.data] : change.kind === "event-resource" ? change.events : []);
        };
        const persist = () => replaceExternalEventResource("caldav", actor, calendar.id, collection, resource, normalizeCaldavResource({ url: resource, etag: state.etag, data: state.data }).map(native => ({ externalId: native.externalId, etag: state.etag, icalUid: "rsvp-fixture", values: { title: native.title, description: native.description, location: native.location, url: native.url, organizer: native.organizer ?? "", recurrence: native.recurrence, start: native.start, end: native.end, isAllDay: native.isAllDay, color: "red" }, time: { timeModel: native.timeModel!, externalSeriesID: native.externalSeriesID, originalStart: native.originalStart, isCanceled: native.isCanceled }, providerState: caldavRsvpState(state.data) })));
        config.api.providerRsvpEditsEnabled = true;
        await persist();
        const [mapping] = await db.select().from(externalEvents).where(eq(externalEvents.calendarID, calendar.id));
        const original = (await getEventSnapshot(mapping!.eventID))!;
        const savedEvents = () => db.select().from(events).where(eq(events.creatorID, actor));
        const savedMaps = () => db.select().from(externalEvents).where(eq(externalEvents.calendarID, calendar.id));
        const journal = () => db.select().from(eventOutbox).where(eq(eventOutbox.userID, actor));
        const untouched = await savedEvents(), originalMaps = await savedMaps();
        const observation = await getOwnProviderEventObservation(actor, original.id);
        const request = { operationID: randomUUID(), provider: "caldav", expectedRevision: original.revision, expectedStateVersion: observation.version!, response: "accepted", notificationPolicy: "server-reply" };
        config.api.providerRsvpEditsEnabled = scenario !== "disabled";
        if (scenario === "viewer") await db.update(calendarMembers).set({ role: "viewer" }).where(eq(calendarMembers.calendarID, calendar.id));
        const endpoint = `${origin}/events/${original.id}/provider-rsvp`;
        if (["disabled", "viewer"].includes(scenario)) {
          await assert.rejects(() => queueProviderRsvp(actor, original.id, request)); assert.equal(state.puts, 0); assert.equal((await journal()).length, 0); continue;
        }
        const preview = await fetch(`${origin}/events/${original.id}/provider-state`, { headers });
        const previewText = await preview.text(); assert.equal(preview.status, 200);
        const shown = ProviderEventStateResponseSchema.parse(JSON.parse(previewText)); assert.equal(shown.rsvpEdit?.provider, "caldav");
        for (const secret of ["BEGIN:VCALENDAR", "/principal/", "schedule-before", "Private alarm"]) assert.ok(!previewText.includes(secret));
        assert.equal((await fetch(endpoint, { method: "POST", headers, body: JSON.stringify({ ...request, notificationPolicy: undefined, sendUpdates: "all" }) })).status, 400);
        const response = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify(request) });
        const receipt = ProviderRsvpReceiptSchema.parse(await response.json()); assert.equal(response.status, 202); assert.equal(receipt.notificationDelivery, "unknown");
        if (scenario === "concurrent") {
          const replays = await Promise.all([queueProviderRsvp(actor, original.id, request), queueProviderRsvp(actor, original.id, request)]);
          assert.ok(replays.every(value => value.replayed && value.operationID === receipt.operationID));
        }
        await assert.rejects(() => queueProviderRsvp(actor, original.id, { ...request, response: "declined" }));
        assert.equal((await journal()).length, 1); assert.deepEqual(await savedEvents(), untouched); assert.deepEqual(await savedMaps(), originalMaps);
        const row = (await journal())[0]!;
        assert.equal(row.payload.rsvp!.request.provider, "caldav"); assert.equal(row.payload.rsvp!.baseline.before, state.data);
        assert.equal((await getEventDeliveryStatus(actor, original.id)).targets[0]!.caldavRsvpPhase, "queued");
        assert.deepEqual(row.payload.rsvp!.caldavDelivery, { kind: "caldav-rsvp-at-most-once", version: 1 });
        assert.equal(state.puts, 0);
        if (scenario.startsWith("marker-")) {
          const claimed = (await claimEventOutbox(row.id))!;
          assert.ok(claimed.leaseToken);
          if (scenario === "marker-expired") await db.update(eventOutbox).set({ leaseUntil: new Date(0) }).where(eq(eventOutbox.id, row.id));
          if (scenario === "marker-payload") await db.update(eventOutbox).set({ payload: { ...claimed.payload, rsvp: { ...claimed.payload.rsvp!, baseline: { ...claimed.payload.rsvp!.baseline, changed: true } } } }).where(eq(eventOutbox.id, row.id));
          if (scenario === "marker-source") await db.update(externalEvents).set({ etag: '"changed"' }).where(eq(externalEvents.id, mapping!.id));
          if (scenario === "marker-disconnected") await db.delete(caldavAccounts).where(eq(caldavAccounts.id, account.id));
          if (scenario === "marker-flag") config.api.providerRsvpEditsEnabled = false;
          if (["marker-legacy", "marker-malformed"].includes(scenario)) {
            if (scenario === "marker-legacy") delete claimed.payload.rsvp!.caldavDelivery;
            else claimed.payload.rsvp!.caldavDelivery = { kind: "caldav-rsvp-at-most-once", version: 2 } as any;
            await db.update(eventOutbox).set({ payload: claimed.payload }).where(eq(eventOutbox.id, row.id));
          }
          if (["marker-race", "marker-retry", "marker-crash", "marker-reclaim"].includes(scenario)) {
            assert.deepEqual((await Promise.all([markCaldavRsvpDispatched(claimed), markCaldavRsvpDispatched(claimed)])).sort(), [false, true]);
            const marked = (await journal())[0]!;
            assert.ok(CaldavRsvpDeliverySchema.parse(marked.payload.rsvp!.caldavDelivery).startedAt);
            assert.equal(marked.uncertain, true);
            assert.equal((await getEventDeliveryStatus(actor, original.id)).targets[0]!.caldavRsvpPhase, "check-only");
            assert.equal(await markCaldavRsvpDispatched(marked), false);
            if (scenario === "marker-reclaim") {
              await db.update(eventOutbox).set({ leaseUntil: new Date(0) }).where(eq(eventOutbox.id, row.id));
              const reclaimed = (await claimEventOutbox(row.id))!;
              assert.ok(reclaimed.reconciling);
              assert.notEqual(reclaimed.leaseToken, claimed.leaseToken);
              assert.deepEqual(reclaimed.payload.rsvp!.caldavDelivery, marked.payload.rsvp!.caldavDelivery);
              assert.equal(await markCaldavRsvpDispatched(claimed), false);
              assert.equal(await markCaldavRsvpDispatched(reclaimed), false);
              // Let the worker reclaim the actual expired attempting row too.
              await db.update(eventOutbox).set({ leaseUntil: new Date(0) }).where(eq(eventOutbox.id, row.id));
              const recovered = await deliverEventOutbox(row.id, () => caldavAdapter);
              assert.notEqual(recovered?.status, "completed");
              const checked = (await journal())[0]!;
              assert.equal(checked.attempts, claimed.attempts + 2);
              assert.equal(checked.uncertain, true);
              assert.deepEqual(checked.payload.rsvp!.caldavDelivery, marked.payload.rsvp!.caldavDelivery);
              assert.equal((await getEventDeliveryStatus(actor, original.id)).targets[0]!.caldavRsvpPhase, "check-only");
            }
            if (["marker-retry", "marker-crash"].includes(scenario)) {
              await db.update(eventOutbox).set({ status: "unconfirmed", leaseToken: null, leaseUntil: null }).where(eq(eventOutbox.id, row.id));
              await requestEventDeliveryRetry(actor, original.id, row.id);
              const retried = (await journal())[0]!;
              assert.deepEqual(retried.payload, marked.payload);
              assert.equal(retried.uncertain, true);
              assert.equal(retried.status, "unconfirmed");
              assert.equal((await getEventDeliveryStatus(actor, original.id)).targets[0]!.caldavRsvpPhase, "check-only");
              if (scenario === "marker-crash") {
                await db.update(eventOutbox).set({ nextAttemptAt: new Date(0) }).where(eq(eventOutbox.id, row.id));
                const recovered = await deliverEventOutbox(row.id, () => caldavAdapter);
                assert.notEqual(recovered?.status, "completed");
                assert.deepEqual((await journal())[0]!.payload.rsvp!.caldavDelivery, marked.payload.rsvp!.caldavDelivery);
                assert.equal((await journal())[0]!.uncertain, true);
              }
            }
          } else {
            assert.equal(await markCaldavRsvpDispatched(claimed), false);
            assert.equal((await journal())[0]!.payload.rsvp!.caldavDelivery?.startedAt, undefined);
          }
          assert.equal(state.puts, 0); continue;
        }
        if (["legacy-readonly", "legacy-recovered"].includes(scenario)) {
          delete row.payload.rsvp!.caldavDelivery;
          await db.update(eventOutbox).set({ payload: row.payload }).where(eq(eventOutbox.id, row.id));
          assert.equal((await getEventDeliveryStatus(actor, original.id)).targets[0]!.caldavRsvpPhase, "check-only");
          if (scenario === "legacy-recovered") { state.data = String(row.payload.rsvp!.baseline.after); state.etag = '"legacy-after"'; }
          const legacy = await deliverEventOutbox(row.id, () => caldavAdapter);
          if (scenario === "legacy-recovered") assert.equal(legacy?.status, "completed");
          else assert.notEqual(legacy?.status, "completed");
          assert.equal(state.puts, 0);
          assert.equal((await getEventDeliveryStatus(actor, original.id)).targets[0]!.caldavRsvpPhase, scenario === "legacy-recovered" ? "observed" : "check-only");
          assert.equal((await journal())[0]!.payload.rsvp!.caldavDelivery, undefined);
          continue;
        }
        if (scenario === "pending-pull") { await assert.rejects(persist); assert.deepEqual(await savedEvents(), untouched); }
        if (scenario === "forged-ack") {
          const claimed = (await claimEventOutbox(row.id))!;
          const result = { externalEventId: resource, etag: '"fabricated"', icalUid: "rsvp-fixture" };
          const expected = { externalEventId: resource, etag: row.expectedEtag, icalUid: "rsvp-fixture" };
          assert.equal(await completeEventOutbox(row.id, claimed.leaseToken!, result, expected), undefined);
          await completeProviderRsvpOutbox(row.id, claimed.leaseToken!, result, expected, { isEcho: true, externalEventId: resource, etag: result.etag, deleted: false, providerState: row.payload.rsvp!.desiredState, observedAt: new Date().toISOString() });
          assert.notEqual((await journal())[0]!.status, "completed"); assert.deepEqual(await savedMaps(), originalMaps); assert.equal(state.puts, 0); continue;
        }
        if (scenario === "worker-disabled") config.api.providerRsvpEditsEnabled = false;
        if (scenario === "mapping-before") await db.update(externalEvents).set({ etag: '"changed"' }).where(eq(externalEvents.id, mapping!.id));
        if (scenario === "source-before") await db.update(externalCalendars).set({ disabled: true }).where(eq(externalCalendars.calendarID, calendar.id));
        if (scenario === "account-after-read") state.onRead = async () => { await db.delete(caldavAccounts).where(eq(caldavAccounts.id, account.id)); };
        if (scenario === "permission-before") state.mode = "no-reply";
        if (scenario === "changed-native") { state.data = state.data.replace("Private notes", "Different private notes"); state.etag = '"changed"'; }
        if (["echo-before-ack", "echo-dst-duration"].includes(scenario)) state.onPut = async () => { const native = importEvents()[0]!; assert.equal(native.timeModel, undefined); assert.equal((native.reminderTimeEvidence && "timeModel" in native.reminderTimeEvidence ? native.reminderTimeEvidence.timeModel.kind : undefined), "zoned");
          if (scenario === "echo-dst-duration") {
            assert.equal(original.end.toISOString(), "2026-03-29T08:00:00.000Z");
            assert.equal(native.end.toISOString(), "2026-03-29T07:00:00.000Z");
            assert.ok(native.reminderTimeEvidence && "timeModel" in native.reminderTimeEvidence);
            assert.equal(native.reminderTimeEvidence.start.toISOString(), "2026-03-28T08:00:00.000Z");
            assert.equal(native.reminderTimeEvidence.end.toISOString(), "2026-03-29T08:00:00.000Z");
          }
          await upsertExternalEvent("caldav", actor, calendar.id, collection, resource, { title: native.title, description: native.description, location: native.location, url: native.url, organizer: native.organizer ?? "", recurrence: native.recurrence, start: native.start, end: native.end, isAllDay: native.isAllDay, color: "red" }, state.etag, "rsvp-fixture", undefined, undefined, undefined, native.providerState, native.reminderTimeEvidence); assert.notEqual((await journal())[0]!.status, "conflict"); };
        if (["OPTIONS-429", "PROPFIND-503"].includes(scenario)) state.mode = scenario;
        if (scenario === "role-after") state.onPut = async () => { await db.update(calendarMembers).set({ role: "viewer" }).where(eq(calendarMembers.calendarID, calendar.id)); };
        if (scenario === "revision-after") state.onPut = async () => { await db.update(events).set({ revision: sql`${events.revision} + 1` }).where(eq(events.id, original.id)); };
        if (scenario === "lease-after") state.onPut = async () => { await db.update(eventOutbox).set({ leaseUntil: new Date(0) }).where(eq(eventOutbox.id, row.id)); };
        if (["lost", "metadata"].includes(scenario)) state.mode = scenario;
        if (scenario === "dispatch-412") state.mode = "race";
        let delivered = await deliverEventOutbox(row.id, () => caldavAdapter);
        if (scenario === "dispatch-412") {
          assert.equal(delivered?.status, "conflict");
          const marked = (await journal())[0]!;
          assert.ok(marked.payload.rsvp!.caldavDelivery?.startedAt);
          assert.equal(marked.uncertain, true); assert.equal(state.puts, 1);
          assert.equal((await getEventDeliveryStatus(actor, original.id)).targets[0]!.caldavRsvpPhase, "check-only");
          await requestEventDeliveryRetry(actor, original.id, row.id);
          state.mode = "ok";
          await db.update(eventOutbox).set({ nextAttemptAt: new Date(0) }).where(eq(eventOutbox.id, row.id));
          await deliverEventOutbox(row.id, () => caldavAdapter);
          const checked = (await journal())[0]!;
          assert.deepEqual(checked.payload.rsvp!.caldavDelivery, marked.payload.rsvp!.caldavDelivery);
          assert.equal(checked.uncertain, true); assert.equal(state.puts, 1);
          assert.notEqual(checked.status, "completed");
          assert.equal((await getEventDeliveryStatus(actor, original.id)).targets[0]!.caldavRsvpPhase, "check-only");
          continue;
        }
        if (["OPTIONS-429", "PROPFIND-503"].includes(scenario)) {
          assert.equal(delivered?.status, "retry"); assert.equal(state.puts, 0);
          assert.ok((await journal())[0]!.nextAttemptAt!.getTime() > Date.now() + 14000);
          state.mode = "ok"; await db.update(eventOutbox).set({ nextAttemptAt: new Date(0) }).where(eq(eventOutbox.id, row.id));
          delivered = await deliverEventOutbox(row.id, () => caldavAdapter);
        }
        if (scenario === "lost") {
          assert.equal(delivered?.status, "unconfirmed"); state.mode = "ok";
          await db.update(eventOutbox).set({ nextAttemptAt: new Date(0) }).where(eq(eventOutbox.id, row.id));
          delivered = await deliverEventOutbox(row.id, () => caldavAdapter);
        }
        if (["worker-disabled", "mapping-before", "source-before", "permission-before", "account-after-read", "changed-native", "role-after", "revision-after", "lease-after"].includes(scenario)) {
          if (scenario === "account-after-read") assert.equal(state.puts, 0);
          assert.notEqual(delivered?.status, "completed"); assert.equal((await savedMaps())[0]!.etag, scenario === "mapping-before" ? '"changed"' : mapping!.etag); continue;
        }
        assert.equal((await getEventDeliveryStatus(actor, original.id)).targets[0]!.caldavRsvpPhase, "observed");
        assert.equal(delivered?.status, "completed"); assert.equal(state.puts, ["no-op", "lowercase-no-op"].includes(scenario) ? 0 : 1);
        assert.deepEqual(await savedEvents(), untouched);
        const [accepted] = await savedMaps(); assert.equal(accepted!.id, mapping!.id); assert.equal(accepted!.etag, state.etag);
        assert.equal(accepted!.providerState!.attendees.find(item => item.address === "mailto:self@example.test")!.response, scenario === "lowercase-no-op" ? "accepted" : "ACCEPTED");
        if (scenario === "lowercase-no-op") {
          const reopened = await fetch(`${origin}/events/${original.id}/provider-state`, { headers });
          assert.equal((await reopened.json()).rsvpEdit?.provider, "caldav");
        }
        assert.equal(await persist(), false); assert.deepEqual(await savedEvents(), untouched);
        assert.equal((await queueProviderRsvp(actor, original.id, request)).operationID, row.id); assert.equal(state.puts, ["no-op", "lowercase-no-op"].includes(scenario) ? 0 : 1);
        console.log(`CalDAV RSVP DB ${scenario}: private intent, full native ACK, unchanged canonical event and replay: OK`);
      } finally { config.api.providerRsvpEditsEnabled = true; await db.delete(user).where(eq(user.id, actor)); await fixture.close(); }
    }
  } finally { config.api.providerRsvpEditsEnabled = flag; config.api.eventTimeEditsEnabled = timeFlag; api.closeAllConnections(); await new Promise<void>(resolve => api.close(() => resolve())); }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
