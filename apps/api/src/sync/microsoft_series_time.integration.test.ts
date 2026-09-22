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
  const oldFetch = globalThis.fetch, oldFlag = config.api.providerOrganizerEditsEnabled, oldTime = config.api.eventTimeEditsEnabled;
  config.api.providerOrganizerEditsEnabled = true;
  try {
    for (const mode of ["series", "personal", "canonical", "master-target", "combined", "duration", "noop", "exceptions", "cancelled", "until", "all-day", "non-utc", "date-change", "overnight", "flag-off", "flag-delivery", "stale-admission", "stale-delivery", "sibling-change", "lost-applied", "lost-retained", "restart", "accepted-recovery", "local-race", "denied", "identity", "partial", "wrong-time", "wrong-slot", "wrong-id", "changed-body", "changed-guest", "raw-master-change", "rejected", "attachments", "conference", "bad-response", "rsvp-reset", "rsvp-reset-time", "rsvp-reset-role", "rsvp-sibling", "delayed-readback"] as const) {
      const owner = `graph-series-time-${randomUUID()}`, allDay = mode === "all-day";
      config.api.eventTimeEditsEnabled = mode !== "flag-off";
      let writes = 0, delivery = false, staleRead = false;
      let base: any = { id: "master", iCalUId: "master-uid", "@odata.etag": 'W/"master-1"', createdDateTime: "2026-09-01T10:00:00Z", type: "seriesMaster", subject: "Series", body: { contentType: "text", content: "Notes" }, location: { displayName: "Office" }, organizer: { emailAddress: { address: "owner@example.test" } }, isOrganizer: true, isCancelled: false, isDraft: false, isOnlineMeeting: false, onlineMeeting: null, onlineMeetingUrl: null, attendees: [{ emailAddress: { address: "guest@example.test" }, type: "required", status: { response: "accepted" } }], hasAttachments: false, isAllDay: allDay, originalStartTimeZone: "UTC", originalEndTimeZone: "UTC", start: { dateTime: `2026-09-25T${allDay ? "00" : "09"}:00:00`, timeZone: "UTC" }, end: { dateTime: allDay ? "2026-09-26T00:00:00" : "2026-09-25T10:00:00", timeZone: "UTC" }, recurrence: { pattern: { type: "daily", interval: 1 }, range: { type: "numbered", numberOfOccurrences: 3, startDate: "2026-09-25", recurrenceTimeZone: "UTC" } }, cancelledOccurrences: [], exceptionOccurrences: [], isReminderOn: true, reminderMinutesBeforeStart: 15, showAs: "busy", sensitivity: "normal", responseStatus: { response: "organizer" } };
      if (mode === "personal") base.attendees = [];
      if (mode === "attachments") base.hasAttachments = true;
      if (mode === "conference") { base.isOnlineMeeting = true; base.onlineMeetingUrl = "https://teams.example.test/meeting"; }
      let instances: any[] = [25, 26, 27].map(day => ({ ...structuredClone(base), id: `occ-${day}`, iCalUId: `uid-${day}`, "@odata.etag": `W/"occ-${day}"`, type: "occurrence", seriesMasterId: "master", originalStart: `2026-09-${day}T${allDay ? "00" : "09"}:00:00Z`, recurrence: null, start: { dateTime: `2026-09-${day}T${allDay ? "00" : "09"}:00:00`, timeZone: "UTC" }, end: { dateTime: allDay ? `2026-09-${day + 1}T00:00:00` : `2026-09-${day}T10:00:00`, timeZone: "UTC" } }));

      if (mode === "exceptions" || mode === "sibling-change") {
        if (mode === "exceptions") { instances[0].type = "exception"; instances[0].subject = "Independent title"; base.exceptionOccurrences = [instances[0]]; }
      }
      if (mode === "cancelled") { instances = instances.slice(0, 2); base.cancelledOccurrences = ["cancelled-slot"]; }
      if (mode === "until") base.recurrence.range = { type: "endDate", startDate: "2026-09-25", endDate: "2026-09-27", recurrenceTimeZone: "UTC" };
      if (mode === "non-utc") {
        base.originalStartTimeZone = base.originalEndTimeZone = base.recurrence.range.recurrenceTimeZone = "Europe/Prague";
        for (const instance of instances) instance.originalStartTimeZone = instance.originalEndTimeZone = "Europe/Prague";
      }
      const originalInstances = structuredClone(instances);
      const patch: any = { ...(mode === "combined" ? { title: "New series", description: null, location: "Room B" } : {}), time: { kind: "zoned", timeZone: "UTC", startLocal: `2026-09-25T${["noop", "duration"].includes(mode) ? "09" : "13"}:00:00`, endLocal: mode === "noop" ? "2026-09-25T10:00:00" : "2026-09-25T14:30:00" } };
      if (mode === "date-change") { patch.time.startLocal = "2026-09-26T13:00:00"; patch.time.endLocal = "2026-09-26T14:30:00"; }
      if (mode === "overnight") patch.time.endLocal = "2026-09-26T01:00:00";
      const intended = resolveEventTimeEdit(patch.time);
      const payload = { ...(mode === "combined" ? { subject: "New series", body: { contentType: "text", content: "" }, location: { displayName: "Room B" } } : {}), start: { dateTime: intended.start.toISOString().slice(0, -1), timeZone: "UTC" }, end: { dateTime: intended.end.toISOString().slice(0, -1), timeZone: "UTC" } };
      function applyUpdate() {
        Object.assign(base, payload, { "@odata.etag": 'W/"master-2"' });
        if (mode.startsWith("rsvp-")) base.attendees[0].status = { response: "notResponded", time: mode === "rsvp-reset-time" ? "2026-09-22T12:00:00Z" : "4501-01-01T00:00:00Z" };
        if (mode === "rsvp-reset-role") base.attendees[0].type = "optional";
        for (const instance of instances) {
          const date = instance.originalStart.slice(0, 10);
          Object.assign(instance, structuredClone(payload), { "@odata.etag": `W/"${instance.id}-updated"`, attendees: structuredClone(base.attendees),
            start: { dateTime: `${date}T${patch.time.startLocal.slice(11)}.000`, timeZone: "UTC" }, end: { dateTime: `${date}T${patch.time.endLocal.slice(11)}.000`, timeZone: "UTC" },
            originalStart: `${date}T${patch.time.startLocal.slice(11)}Z` });
        }
      }
      const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
      globalThis.fetch = async (input, init) => {
        const url = new URL(String(input)); assert.equal(url.origin, "https://graph.microsoft.com"); assert.equal(init?.redirect, "error");
        if (url.pathname === "/v1.0/me") return response({ id: delivery && mode === "identity" ? "other-user" : "graph-user", mail: "owner@example.test", userPrincipalName: "owner@example.test" });
        if (url.pathname === "/v1.0/me/calendar") return response({ id: "native-calendar", isDefaultCalendar: true, canEdit: true, owner: { address: "owner@example.test" } });
        if (url.pathname === "/v1.0/me/calendars/native-calendar") return response({ id: "native-calendar" });
        if (mode === "delayed-readback" && writes && !staleRead && url.pathname.endsWith("/instances")) { staleRead = true; return response({ value: originalInstances }); }
        if (url.pathname.endsWith("/instances")) return response({ value: mode === "partial" ? instances.slice(0, 1) : instances });
        if (init?.method === "PATCH") {
          assert.ok(url.pathname.endsWith("/master"));
          assert.equal(new Headers(init.headers).get("If-Match"), 'W/"master-1"');
          assert.deepEqual(JSON.parse(String(init.body)), payload); writes++;
          const journal = (await db.select().from(eventOutbox).where(eq(eventOutbox.actorID, owner))).find(row => row.status === "attempting")!;
          assert.ok(journal.payload.graphOccurrenceContent?.dispatch?.startedAt, "Permanent marker precedes PATCH");
          if (mode === "rejected") return response({ error: { code: "ErrorPreconditionFailed" } }, 412);
          if (mode !== "lost-retained") applyUpdate();
          if (mode.startsWith("lost-")) throw new Error("Lost response");
          if (mode === "wrong-time") instances[0].end.dateTime = "2026-09-25T16:00:00.000";
          if (mode === "wrong-slot") instances[0].originalStart = "2026-09-25T09:00:00Z";
          if (mode === "wrong-id") instances[0].id = "replacement-id";
          if (mode === "changed-body") { base.body.content = "Concurrent notes"; for (const instance of instances) instance.body.content = base.body.content; }
          if (mode === "changed-guest") instances[1].attendees[0].status.response = "declined";
          if (mode === "rsvp-sibling") instances[1].attendees[0].status.response = "accepted";
          if (mode === "raw-master-change") base.importance = "high";
          return response(mode === "bad-response" ? { ...base, id: "wrong-id" } : base);
        }
        const nativeID = url.pathname.split("/").pop();
        const native = nativeID === "master" ? base : instances.find(value => value.id === nativeID);
        return native ? response(native) : response({ error: { code: "ErrorItemNotFound" } }, 404);
      };
      await db.insert(user).values({ id: owner, name: "Fixture", email: `${owner}@example.test` });
      try {
        await db.insert(account).values({ id: randomUUID(), userId: owner, providerId: "microsoft", accountId: "fixture", scope: "Calendars.ReadWrite", refreshToken: "fixture", accessToken: "fixture", accessTokenExpiresAt: new Date(Date.now() + 3_600_000) });
        const calendar = await importExternalCalendar("microsoft", owner, "fixture", "Fixture", { externalId: "native-calendar", name: "Fixture", color: "red" });
        const time = resolveEventTimeEdit(allDay ? { kind: "all-day", startDate: "2026-09-25", endDate: "2026-09-25" } : { kind: "zoned", timeZone: mode === "non-utc" ? "Europe/Prague" : "UTC", startLocal: mode === "non-utc" ? "2026-09-25T11:00:00" : "2026-09-25T09:00:00", endLocal: mode === "non-utc" ? "2026-09-25T12:00:00" : "2026-09-25T10:00:00" });
        const template = EventSchema.parse({ id: randomUUID(), creatorID: owner, title: "Series", organizer: "owner@example.test", color: "red", recurrence: "RRULE:FREQ=DAILY;COUNT=3", isCanceled: false, calendars: [calendar.id], ...time });
        const observation = graphFamilyObservation(graphSeriesFamilyEvidence(base, instances, template, { externalEventId: "master", icalUid: "master-uid" }));
        const canonical = mode === "canonical" || mode === "master-target";
        if (canonical) {
          await upsertExternalEvent("microsoft", owner, calendar.id, "native-calendar", "master", { ...observation.master.values, color: "red" }, base["@odata.etag"], "master-uid", undefined, { timeModel: time.timeModel }, undefined, observation.master.providerState);
          await replaceGraphFamily(await readGraphFamilyContext({ userID: owner, accountID: "fixture", calendarID: calendar.id, externalMasterID: "master" }), observation);
        } else {
          for (const item of originalInstances) {
            const n = toNormalized(item);
            await upsertExternalEvent("microsoft", owner, calendar.id, "native-calendar", n.externalId, { title: n.title, start: n.start, end: n.end, isAllDay: n.isAllDay, description: n.description, location: n.location, organizer: n.organizer ?? "", recurrence: null, url: n.url, color: "red" }, n.etag, n.icalUid, undefined, undefined, { externalSeriesID: "master", originalStart: { kind: "instant", value: new Date(item.originalStart).toISOString() } }, n.providerState, undefined, "master");
          }
        }
        const oldMappings = await db.select().from(externalEvents).where(eq(externalEvents.calendarID, calendar.id));
        const mapping = oldMappings.find(m => m.externalEventID === (mode === "master-target" ? "master" : "occ-26"))!;
        const event = (await getEventSnapshot(mapping.eventID))!;
        const state = await getOwnProviderEventObservation(owner, event.id);
        const capability = await observeProviderOrganizer(owner, event.id, state, "series-time");
        ProviderEventStateResponseSchema.parse(capability);
        const unsupported = ["exceptions", "cancelled", "until", "all-day", "non-utc", "flag-off", "partial", "attachments", "conference"].includes(mode);
        assert.equal(!!capability.outlookSeriesContent?.time, !unsupported, `Time capability: ${mode}`);
        for (const version of ["series-content", "occurrence-time", "occurrence-zone-time", "occurrence-all-day-time"] as const)
          assert.equal((await observeProviderOrganizer(owner, event.id, state, version)).outlookSeriesContent?.time, undefined, "Older strict clients do not receive the v8 field");
        if (["partial", "attachments", "conference"].includes(mode)) { assert.equal(writes, 0); continue; }
        assert.ok(capability.outlookSeriesContent?.seriesVersion);
        const request = { provider: "microsoft", action: "update", patch, notificationPolicy: "server-invite", operationID: randomUUID(), eventID: event.id, calendarID: calendar.id, scope: "series", expectedRevision: event.revision, expectedStateVersion: state.version, expectedSeriesVersion: capability.outlookSeriesContent.seriesVersion };
        if (unsupported || ["date-change", "overnight", "stale-admission"].includes(mode)) {
          if (mode === "stale-admission") base["@odata.etag"] = 'W/"changed"';
          await assert.rejects(() => queueProviderOrganizer(owner, request)); assert.equal(writes, 0); continue;
        }
        assert.equal(capability.outlookSeriesContent.time?.startLocal.slice(0, 10), "2026-09-25", "Master date, not the selected later occurrence");
        await queueProviderOrganizer(owner, request);
        assert.equal((await queueProviderOrganizer(owner, request)).replayed, true);
        await assert.rejects(() => queueProviderOrganizer(owner, { ...request, patch: { ...patch, title: "Changed retry" } }));
        const n = observation.instances[0];
        await assert.rejects(() => upsertExternalEvent("microsoft", owner, calendar.id, "native-calendar", n.externalID, { ...n.values, color: "red" }, n.etag, n.icalUid), "Pending time edit fences ordinary pull");
        if (mode === "stale-delivery") base["@odata.etag"] = 'W/"changed"';
        if (mode === "sibling-change") { instances[0].type = "exception"; instances[0].subject = "Concurrent change"; base.exceptionOccurrences = [instances[0]]; }
        if (mode === "flag-delivery") config.api.eventTimeEditsEnabled = false;
        if (mode === "denied") await db.update(calendarMembers).set({ role: "viewer" }).where(eq(calendarMembers.calendarID, calendar.id));
        if (mode === "local-race") await db.update(events).set({ revision: sql`${events.revision} + 1` }).where(eq(events.id, event.id));
        if (mode === "restart" || mode === "accepted-recovery") {
          const claimed = await claimEventOutbox(request.operationID); assert.ok(claimed);
          assert.equal(await completeEventOutbox(claimed.id, claimed.leaseToken!, null, null), undefined);
          await markGraphOccurrenceContent(claimed);
          await assert.rejects(() => completeGraphOccurrenceContent(claimed, observation));
          if (mode === "accepted-recovery") { applyUpdate(); await markGraphOccurrenceContent(claimed, true); config.api.eventTimeEditsEnabled = false; }
          await db.update(eventOutbox).set({ status: "unconfirmed", leaseToken: null, leaseUntil: null, nextAttemptAt: new Date(0) }).where(eq(eventOutbox.id, request.operationID));
        }
        delivery = true;
        const run = () => deliverEventOutbox(request.operationID, () => microsoftAdapter);
        const result = await run();
        const succeeds = ["series", "personal", "canonical", "master-target", "combined", "duration", "noop", "accepted-recovery", "rsvp-reset", "delayed-readback"].includes(mode);
        assert.equal(result?.status === "completed", succeeds, `${mode}: ${result?.status} ${result?.errorCode}`);
        assert.equal(writes, ["noop", "accepted-recovery", "restart", "stale-delivery", "sibling-change", "flag-delivery", "local-race", "denied", "identity"].includes(mode) ? 0 : 1, mode);
        if (!succeeds && writes && mode !== "rejected" || mode === "restart") {
          const count = writes;
          await requestEventDeliveryRetry(owner, event.id, request.operationID);
          await db.update(eventOutbox).set({ nextAttemptAt: new Date(0) }).where(eq(eventOutbox.id, request.operationID));
          assert.notEqual((await run())?.status, "completed"); assert.equal(writes, count, "Retry must never resend");
        }
        if (succeeds) {
          const rows = await db.select().from(events).where(eq(events.creatorID, owner));
          const maps = await db.select().from(externalEvents).where(eq(externalEvents.calendarID, calendar.id));
          assert.deepEqual(maps.map(m => [m.id, m.eventID, m.externalEventID]).sort(), oldMappings.map(m => [m.id, m.eventID, m.externalEventID]).sort(), "Stable local and provider IDs");
          const visible = expandRecurringEvents(rows.filter(e => !e.deletedAt), new Date("2026-09-01Z"), new Date("2026-10-01Z"), { consumerTimeZone: "UTC" });
          assert.equal(visible.length, 3, "No duplicate old slots or missing instances");
          for (const row of rows) {
            const map = maps.find(m => m.eventID === row.id)!;
            const item = map.externalEventID === "master" ? base : instances.find(i => i.id === map.externalEventID)!;
            assert.equal(row.start.toISOString(), new Date(item.start.dateTime + "Z").toISOString());
            assert.equal(row.end.toISOString(), new Date(item.end.dateTime + "Z").toISOString());
            assert.equal(row.title, item.subject); assert.equal(row.description, item.body.content.trim() || null); assert.equal(row.location, item.location.displayName.trim() || null);
            if (item.type === "occurrence") {
              assert.deepEqual(map.originalStart, { kind: "instant", value: new Date(item.originalStart).toISOString() });
              assert.deepEqual(row.originalStart, canonical ? map.originalStart : null, "Keep flat imports flat; rebind canonical children");
            }
          }
          config.api.eventTimeEditsEnabled = true;
          const refreshed = await observeProviderOrganizer(owner, event.id, await getOwnProviderEventObservation(owner, event.id), "series-time");
          assert.ok(refreshed.outlookSeriesContent?.time, "A second time edit remains available after rebinding");
          if (canonical) {
            const current = graphFamilyObservation(graphSeriesFamilyEvidence(base, instances, { ...template, ...intended }, { externalEventId: "master", icalUid: "master-uid" }));
            await replaceGraphFamily(await readGraphFamilyContext({ userID: owner, accountID: "fixture", calendarID: calendar.id, externalMasterID: "master" }), current);
            assert.deepEqual((await db.select().from(externalEvents).where(eq(externalEvents.calendarID, calendar.id))).map(m => [m.id, m.eventID]).sort(), maps.map(m => [m.id, m.eventID]).sort(), "Subsequent family sync preserves bindings");
          }
        } else {
          const after = (await getEventSnapshot(event.id))!;
          assert.deepEqual(after.start, event.start); assert.deepEqual(after.end, event.end);
          assert.deepEqual((await db.select().from(externalEvents).where(eq(externalEvents.calendarID, calendar.id))).map(m => m.originalStart), oldMappings.map(m => m.originalStart), "No partial slot commit");
        }
        console.log("Graph series time:", mode, result?.status);
      } finally { await db.delete(user).where(eq(user.id, owner)); }
    }
  } finally { globalThis.fetch = oldFetch; config.api.providerOrganizerEditsEnabled = oldFlag; config.api.eventTimeEditsEnabled = oldTime; }
}
main().then(() => process.exit(0), error => { console.error(error); process.exit(1); });
