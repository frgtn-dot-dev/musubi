import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { config } from "@musubi/config";
import { EventSchema, ProviderEventStateResponseSchema } from "@musubi/types";
import { resolveEventTimeEdit, expandRecurringEvents } from "@musubi/calendar";
import { account, db, user, events, externalEvents, eventOutbox, calendarMembers, importExternalCalendar, upsertExternalEvent, readGraphFamilyContext, replaceGraphFamily, claimEventOutbox, getOwnProviderEventObservation, getEventSnapshot, markGraphOccurrenceContent, completeGraphOccurrenceContent, completeEventOutbox, requestEventDeliveryRetry } from "@musubi/db";
import { graphSeriesFamilyEvidence } from "./adapters/microsoft_series_family";
import { graphFamilyObservation } from "./adapters/microsoft_series_delete";
import { microsoftAdapter, toNormalized } from "./adapters/microsoft";
import { observeProviderOrganizer, queueProviderOrganizer } from "./provider_organizer";
import { deliverEventOutbox } from "./event_delivery";

async function main() {
  assert.equal(process.env.ENVIRONMENT, "test");
  const oldFetch = globalThis.fetch, oldFlag = config.api.providerOrganizerEditsEnabled;
  config.api.providerOrganizerEditsEnabled = true;
  try {
    for (const mode of ["occurrence", "personal", "canonical", "canonical-cancelled", "cancelled-before", "preserved-exception", "all-day", "moved", "clear", "noop", "stale-admission", "stale-delivery", "sibling-change", "lost-applied", "lost-retained", "restart", "accepted-recovery", "local-race", "denied", "identity", "partial", "survivor-changed", "rejected", "changed-guest", "attachments", "conference", "bad-response"] as const) {
      const owner = `graph-series-cancel-${randomUUID()}`, allDay = mode === "all-day";
      let writes = 0, delivery = false;
      const base: any = { id: "master", iCalUId: "master-uid", "@odata.etag": 'W/"master-1"', createdDateTime: "2026-09-01T10:00:00Z", type: "seriesMaster", subject: "Series", body: { contentType: "text", content: "Notes" }, location: { displayName: "Office" }, organizer: { emailAddress: { address: "owner@example.test" } }, isOrganizer: true, isCancelled: false, isDraft: false, isOnlineMeeting: false, onlineMeeting: null, onlineMeetingUrl: null, attendees: [{ emailAddress: { address: "guest@example.test" }, type: "required", status: { response: "accepted" } }], hasAttachments: false, isAllDay: allDay, originalStartTimeZone: "UTC", originalEndTimeZone: "UTC", start: { dateTime: `2026-09-25T${allDay ? "00" : "09"}:00:00`, timeZone: "UTC" }, end: { dateTime: allDay ? "2026-09-26T00:00:00" : "2026-09-25T10:00:00", timeZone: "UTC" }, recurrence: { pattern: { type: "daily", interval: 1 }, range: { type: "numbered", numberOfOccurrences: 3, startDate: "2026-09-25", recurrenceTimeZone: "UTC" } }, cancelledOccurrences: [], exceptionOccurrences: [], isReminderOn: true, reminderMinutesBeforeStart: 15, showAs: "busy", sensitivity: "normal", responseStatus: { response: "organizer" } };
      if (mode === "personal") base.attendees = [];
      if (mode === "attachments") base.hasAttachments = true;
      if (mode === "conference") { base.isOnlineMeeting = true; base.onlineMeetingUrl = "https://teams.example.test/meeting"; }
      let instances: any[] = [25, 26, 27].map(day => ({ ...structuredClone(base), id: `occ-${day}`, iCalUId: `uid-${day}`, "@odata.etag": `W/"occ-${day}"`, type: "occurrence", seriesMasterId: "master", originalStart: `2026-09-${day}T${allDay ? "00" : "09"}:00:00Z`, recurrence: null, start: { dateTime: `2026-09-${day}T${allDay ? "00" : "09"}:00:00`, timeZone: "UTC" }, end: { dateTime: allDay ? `2026-09-${day + 1}T00:00:00` : `2026-09-${day}T10:00:00`, timeZone: "UTC" } }));
      if (mode === "moved") { instances[1].createdDateTime = "2026-09-22T10:00:00Z"; instances[1].type = "exception"; instances[1].subject = "Moved appointment"; instances[1].start.dateTime = "2027-01-10T12:00:00"; instances[1].end.dateTime = "2027-01-10T13:00:00"; base.exceptionOccurrences = [...base.exceptionOccurrences.filter((n: any) => n.id !== instances[1].id), instances[1]]; }

      if (mode.includes("cancelled")) { instances = instances.slice(0, 2); base.cancelledOccurrences = ["already-cancelled-slot"]; }
      if (mode === "preserved-exception") { instances[0].type = "exception"; instances[0].subject = "Different sibling"; instances[0].start.dateTime = "2027-01-10T12:00:00"; instances[0].end.dateTime = "2027-01-10T13:00:00"; base.exceptionOccurrences = [instances[0]]; }
      const originalInstances = structuredClone(instances);
      const patch = mode === "noop" ? { title: "Series" } : mode === "clear" ? { description: null, location: null } : { title: "Updated occurrence", description: "New notes", location: "New office" };
      const payload = mode === "noop" ? { subject: "Series" } : mode === "clear" ? { body: { contentType: "text", content: "" }, location: { displayName: "" } } : { subject: "Updated occurrence", body: { contentType: "text", content: "New notes" }, location: { displayName: "New office" } };
      function applyUpdate() {
        Object.assign(instances[1], payload, { createdDateTime: "2026-09-22T10:00:00Z", type: "exception", "@odata.etag": 'W/"occ-updated"' });
        base.exceptionOccurrences = [...base.exceptionOccurrences.filter((n: any) => n.id !== instances[1].id), instances[1]]; base["@odata.etag"] = 'W/"master-2"';
      }
      const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
      globalThis.fetch = async (input, init) => {
        const url = new URL(String(input)); assert.equal(url.origin, "https://graph.microsoft.com"); assert.equal(init?.redirect, "error");
        if (url.pathname === "/v1.0/me") return response({ id: delivery && mode === "identity" ? "other-user" : "graph-user", mail: "owner@example.test", userPrincipalName: "owner@example.test" });
        if (url.pathname === "/v1.0/me/calendar") return response({ id: "native-calendar", isDefaultCalendar: true, canEdit: true, owner: { address: "owner@example.test" } });
        if (url.pathname === "/v1.0/me/calendars/native-calendar") return response({ id: "native-calendar" });
        if (url.pathname.endsWith("/instances")) return response({ value: mode === "partial" ? instances.slice(0, 1) : instances });
        if (init?.method === "PATCH") {
          assert.ok(url.pathname.endsWith("/occ-26"));
          assert.equal(new Headers(init.headers).get("If-Match"), 'W/"occ-26"');
          assert.deepEqual(JSON.parse(String(init.body)), payload); writes++;
          const journal = (await db.select().from(eventOutbox).where(eq(eventOutbox.actorID, owner))).find(row => row.status === "attempting")!;
          assert.ok(journal.payload.graphOccurrenceContent?.dispatch?.startedAt, "Permanent marker precedes PATCH");
          if (mode === "rejected") return response({ error: { code: "ErrorPreconditionFailed" } }, 412);
          if (mode !== "lost-retained") applyUpdate();
          if (mode.startsWith("lost-")) throw new Error("Lost response");
          if (mode === "survivor-changed") { instances[0].type = "exception"; instances[0].subject = "A concurrent edit"; base.exceptionOccurrences.push(instances[0]); }
          if (mode === "changed-guest") instances[1].attendees[0].status.response = "declined";
          return response(mode === "bad-response" ? { ...instances[1], id: "wrong-id" } : instances[1]);
        }
        const nativeID = url.pathname.split("/").pop();
        const native = nativeID === "master" ? base : instances.find(value => value.id === nativeID);
        return native ? response(native) : response({ error: { code: "ErrorItemNotFound" } }, 404);
      };
      await db.insert(user).values({ id: owner, name: "Fixture", email: `${owner}@example.test` });
      try {
        await db.insert(account).values({ id: randomUUID(), userId: owner, providerId: "microsoft", accountId: "fixture", scope: "Calendars.ReadWrite", refreshToken: "fixture", accessToken: "fixture", accessTokenExpiresAt: new Date(Date.now() + 3_600_000) });
        const calendar = await importExternalCalendar("microsoft", owner, "fixture", "Fixture", { externalId: "native-calendar", name: "Fixture", color: "red" });
        const time = resolveEventTimeEdit(allDay ? { kind: "all-day", startDate: "2026-09-25", endDate: "2026-09-25" } : { kind: "zoned", timeZone: "UTC", startLocal: "2026-09-25T09:00:00", endLocal: "2026-09-25T10:00:00" });
        const template = EventSchema.parse({ id: randomUUID(), creatorID: owner, title: "Series", organizer: "owner@example.test", color: "red", recurrence: "RRULE:FREQ=DAILY;COUNT=3", isCanceled: false, calendars: [calendar.id], ...time });
        const observation = graphFamilyObservation(graphSeriesFamilyEvidence(base, instances, template, { externalEventId: "master", icalUid: "master-uid" }));
        if (mode.startsWith("canonical")) {
          await upsertExternalEvent("microsoft", owner, calendar.id, "native-calendar", "master", { ...observation.master.values, color: "red" }, base["@odata.etag"], "master-uid", undefined, { timeModel: time.timeModel }, undefined, observation.master.providerState);
          const address = { userID: owner, accountID: "fixture", calendarID: calendar.id, externalMasterID: "master" };
          await replaceGraphFamily(await readGraphFamilyContext(address), observation);
        } else {
          for (const item of originalInstances) {
            const n = toNormalized(item);
            await upsertExternalEvent("microsoft", owner, calendar.id, "native-calendar", n.externalId, { title: n.title, start: n.start, end: n.end, isAllDay: n.isAllDay, description: n.description, location: n.location, organizer: n.organizer ?? "", recurrence: null, url: n.url, color: "red" }, n.etag, n.icalUid, undefined, undefined, { externalSeriesID: "master", originalStart: { kind: "instant", value: new Date(item.originalStart).toISOString() } }, n.providerState, undefined, "master");
          }
        }
        const mapping = (await db.select().from(externalEvents).where(eq(externalEvents.calendarID, calendar.id))).find(m => m.externalEventID === "occ-26")!;
        const event = (await getEventSnapshot(mapping.eventID))!;
        const state = await getOwnProviderEventObservation(owner, event.id);
        assert.equal((await observeProviderOrganizer(owner, event.id, state, true)).outlookCancellation, undefined, "v1 clients never receive a new strict response field");
        const capability = await observeProviderOrganizer(owner, event.id, state, "content");
        if (["partial", "attachments", "conference"].includes(mode)) { assert.equal(capability.organizerEdit, undefined); assert.equal(writes, 0); continue; }
        ProviderEventStateResponseSchema.parse(capability);
        assert.ok(capability.organizerEdit?.seriesVersion, `No capability: ${mode}`);
        assert.equal((await observeProviderOrganizer(owner, event.id, state, "series")).organizerEdit, undefined, "v2 clients do not receive the v3 occurrence capability");
        const request = { provider: "microsoft", action: "update", patch, notificationPolicy: "server-invite", operationID: randomUUID(), eventID: event.id, calendarID: calendar.id, scope: "occurrence", expectedRevision: event.revision, expectedStateVersion: state.version, expectedSeriesVersion: capability.organizerEdit.seriesVersion };
        if (mode === "stale-admission") { base["@odata.etag"] = 'W/"changed"'; await assert.rejects(() => queueProviderOrganizer(owner, request)); assert.equal(writes, 0); continue; }
        await queueProviderOrganizer(owner, request);
        assert.equal((await queueProviderOrganizer(owner, request)).replayed, true);
        await assert.rejects(() => queueProviderOrganizer(owner, { ...request, patch: { title: "Different immutable request" } }));
        const n = observation.instances[0];
        await assert.rejects(() => upsertExternalEvent("microsoft", owner, calendar.id, "native-calendar", n.externalID, { ...n.values, color: "red" }, n.etag, n.icalUid), "Pending family content edit fences ordinary pull");
        if (mode === "stale-delivery") base["@odata.etag"] = 'W/"changed"';
        if (mode === "sibling-change") { instances[0].type = "exception"; instances[0].subject = "Concurrent change"; base.exceptionOccurrences = [instances[0]]; }
        if (mode === "denied") await db.update(calendarMembers).set({ role: "viewer" }).where(eq(calendarMembers.calendarID, calendar.id));
        if (mode === "local-race") await db.update(events).set({ revision: sql`${events.revision} + 1` }).where(eq(events.id, event.id));
        if (mode === "restart" || mode === "accepted-recovery") {
          const claimed = await claimEventOutbox(request.operationID); assert.ok(claimed);
          assert.equal(await completeEventOutbox(claimed.id, claimed.leaseToken!, null, null), undefined, "Generic ACK rejects private occurrence content");
          await markGraphOccurrenceContent(claimed);
          await assert.rejects(() => completeGraphOccurrenceContent(claimed, observation), "No completion without durable acceptance");
          if (mode === "accepted-recovery") { applyUpdate(); await markGraphOccurrenceContent(claimed, true); }
          await db.update(eventOutbox).set({ status: "unconfirmed", leaseToken: null, leaseUntil: null, nextAttemptAt: new Date(0) }).where(eq(eventOutbox.id, request.operationID));
        }
        delivery = true;
        const run = () => deliverEventOutbox(request.operationID, () => microsoftAdapter);
        const result = await run();
        const succeeds = ["occurrence", "personal", "canonical", "canonical-cancelled", "cancelled-before", "preserved-exception", "all-day", "moved", "clear", "noop", "accepted-recovery"].includes(mode);
        assert.equal(result?.status === "completed", succeeds, `${mode}: ${result?.status} ${result?.errorCode}`);
        assert.equal(writes, ["occurrence", "personal", "canonical", "canonical-cancelled", "cancelled-before", "preserved-exception", "all-day", "moved", "clear", "lost-applied", "lost-retained", "survivor-changed", "changed-guest", "rejected", "bad-response"].includes(mode) ? 1 : 0);
        if (["lost-applied", "lost-retained", "restart", "survivor-changed", "changed-guest", "bad-response"].includes(mode)) {
          const count = writes;
          await requestEventDeliveryRetry(owner, event.id, request.operationID);
          await db.update(eventOutbox).set({ nextAttemptAt: new Date(0) }).where(eq(eventOutbox.id, request.operationID));
          assert.notEqual((await run())?.status, "completed"); assert.equal(writes, count, "Retries must never send another update");
        }
        if (succeeds) {
          const rows = await db.select().from(events).where(eq(events.creatorID, owner));
          const visible = expandRecurringEvents(rows.filter(e => !e.deletedAt), new Date("2026-09-01Z"), new Date("2027-02-01Z"), { consumerTimeZone: "UTC" });
          assert.equal(visible.length, mode.includes("cancelled") ? 2 : 3);
          const edited = (await getEventSnapshot(event.id))!;
          assert.equal(edited.title, patch.title ?? event.title);
          assert.equal(edited.description, patch.description !== undefined ? patch.description : event.description);
          assert.equal(edited.location, patch.location !== undefined ? patch.location : event.location);
          for (const field of ["start", "end", "timeModel", "seriesID", "originalStart", "recurrence"] as const) assert.deepEqual(edited[field], event[field], field);
        }
        if (["occurrence", "canonical", "rejected"].includes(mode)) {
          const next = (await getEventSnapshot(event.id))!;
          const nextState = await getOwnProviderEventObservation(owner, event.id);
          const refreshed = await observeProviderOrganizer(owner, event.id, nextState, "content");
          assert.ok(refreshed.organizerEdit?.seriesVersion, "Completed or definitely rejected updates allow a fresh edit");
          await queueProviderOrganizer(owner, { ...request, operationID: randomUUID(), expectedRevision: next.revision, expectedStateVersion: nextState.version, expectedSeriesVersion: refreshed.organizerEdit.seriesVersion });
        }
        console.log("Graph occurrence content:", mode, result?.status);
      } finally { await db.delete(user).where(eq(user.id, owner)); }
    }
  } finally { globalThis.fetch = oldFetch; config.api.providerOrganizerEditsEnabled = oldFlag; }
}
main().then(() => process.exit(0), error => { console.error(error); process.exit(1); });
