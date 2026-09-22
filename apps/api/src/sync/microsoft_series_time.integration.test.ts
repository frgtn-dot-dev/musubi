import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { config } from "@musubi/config";
import { EventSchema, ProviderEventStateResponseSchema } from "@musubi/types";
import { resolveEventTimeEdit, expandRecurringEvents, finiteSeriesFootprint } from "@musubi/calendar";
import { account, db, user, events, externalEvents, eventOutbox, calendarMembers, importExternalCalendar, upsertExternalEvent, readGraphFamilyContext, replaceGraphFamily, claimEventOutbox, getOwnProviderEventObservation, getEventSnapshot, markGraphOccurrenceContent, completeGraphOccurrenceContent, completeEventOutbox, requestEventDeliveryRetry, graphSeriesTimeSupported } from "@musubi/db";
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
    for (const mode of ["series", "personal", "canonical", "master-target", "combined", "duration", "noop", "exceptions", "cancelled", "all-day", "non-utc", "date-change", "overnight", "flag-off", "flag-delivery", "stale-admission", "stale-delivery", "sibling-change", "lost-applied", "lost-retained", "restart", "accepted-recovery", "local-race", "denied", "identity", "partial", "wrong-time", "wrong-slot", "wrong-id", "changed-body", "changed-guest", "raw-master-change", "rejected", "attachments", "conference", "bad-response", "rsvp-reset", "rsvp-reset-time", "rsvp-reset-role", "rsvp-sibling", "delayed-readback", "until", "until-personal", "until-canonical", "until-master-target", "until-earlier", "until-weekly", "until-gap", "until-duration", "until-noop", "until-accepted-recovery", "until-lost-applied", "until-lost-retained", "until-rejected", "until-stale-delivery", "until-exceptions", "until-cancelled", "until-range-change", "until-pattern-change", "until-fraction"] as const) {
      const until = mode === "until" || mode.startsWith("until-");
      const scenario = mode.startsWith("until-") ? mode.slice(6) : mode;
      const gap = until && ["gap", "range-change"].includes(scenario);
      const owner = `graph-series-time-${randomUUID()}`, allDay = scenario === "all-day";
      config.api.eventTimeEditsEnabled = scenario !== "flag-off";
      let writes = 0, delivery = false, staleRead = false;
      let base: any = { id: "master", iCalUId: "master-uid", "@odata.etag": 'W/"master-1"', createdDateTime: "2026-09-01T10:00:00Z", type: "seriesMaster", subject: "Series", body: { contentType: "text", content: "Notes" }, location: { displayName: "Office" }, organizer: { emailAddress: { address: "owner@example.test" } }, isOrganizer: true, isCancelled: false, isDraft: false, isOnlineMeeting: false, onlineMeeting: null, onlineMeetingUrl: null, attendees: [{ emailAddress: { address: "guest@example.test" }, type: "required", status: { response: "accepted" } }], hasAttachments: false, isAllDay: allDay, originalStartTimeZone: "UTC", originalEndTimeZone: "UTC", start: { dateTime: `2026-09-25T${allDay ? "00" : "09"}:00:00`, timeZone: "UTC" }, end: { dateTime: allDay ? "2026-09-26T00:00:00" : "2026-09-25T10:00:00", timeZone: "UTC" }, recurrence: { pattern: { type: "daily", interval: 1 }, range: { type: "numbered", numberOfOccurrences: 3, startDate: "2026-09-25", recurrenceTimeZone: "UTC" } }, cancelledOccurrences: [], exceptionOccurrences: [], isReminderOn: true, reminderMinutesBeforeStart: 15, showAs: "busy", sensitivity: "normal", responseStatus: { response: "organizer" } };
      if (scenario === "personal") base.attendees = [];
      if (scenario === "attachments") base.hasAttachments = true;
      if (scenario === "conference") { base.isOnlineMeeting = true; base.onlineMeetingUrl = "https://teams.example.test/meeting"; }
      if (gap) base.recurrence.pattern.interval = 2;
      if (scenario === "weekly") base.recurrence.pattern = { type: "weekly", interval: 1, daysOfWeek: ["friday", "saturday", "sunday"], firstDayOfWeek: "monday" };
      let instances: any[] = (gap ? [25, 27, 29] : [25, 26, 27]).map(day => ({ ...structuredClone(base), id: `occ-${day}`, iCalUId: `uid-${day}`, "@odata.etag": `W/"occ-${day}"`, type: "occurrence", seriesMasterId: "master", originalStart: `2026-09-${day}T${allDay ? "00" : "09"}:00:00Z`, recurrence: null, start: { dateTime: `2026-09-${day}T${allDay ? "00" : "09"}:00:00`, timeZone: "UTC" }, end: { dateTime: allDay ? `2026-09-${day + 1}T00:00:00` : `2026-09-${day}T10:00:00`, timeZone: "UTC" } }));

      if (scenario === "exceptions" || scenario === "sibling-change") {
        if (scenario === "exceptions") { instances[0].type = "exception"; instances[0].subject = "Independent title"; base.exceptionOccurrences = [instances[0]]; }
      }
      if (scenario === "cancelled") { instances = instances.slice(0, 2); base.cancelledOccurrences = ["cancelled-slot"]; }
      if (until) base.recurrence.range = { type: "endDate", startDate: "2026-09-25", endDate: gap || scenario === "weekly" ? "2026-09-30" : "2026-09-27", recurrenceTimeZone: "UTC" };
      if (scenario === "non-utc") {
        base.originalStartTimeZone = base.originalEndTimeZone = base.recurrence.range.recurrenceTimeZone = "Europe/Prague";
        for (const instance of instances) instance.originalStartTimeZone = instance.originalEndTimeZone = "Europe/Prague";
      }
      const originalInstances = structuredClone(instances);
      const patch: any = { ...(scenario === "combined" ? { title: "New series", description: null, location: "Room B" } : {}), time: { kind: "zoned", timeZone: "UTC", startLocal: `2026-09-25T${["noop", "duration"].includes(scenario) ? "09" : "13"}:00:00`, endLocal: scenario === "noop" ? "2026-09-25T10:00:00" : "2026-09-25T14:30:00" } };
      if (scenario === "date-change") { patch.time.startLocal = "2026-09-26T13:00:00"; patch.time.endLocal = "2026-09-26T14:30:00"; }
      if (scenario === "overnight") patch.time.endLocal = "2026-09-26T01:00:00";
      if (scenario === "earlier") { patch.time.startLocal = "2026-09-25T07:00:00"; patch.time.endLocal = "2026-09-25T08:15:00"; }
      if (scenario === "fraction") patch.time.startLocal = "2026-09-25T13:00:00.123";
      const intended = resolveEventTimeEdit(patch.time);
      const payload = { ...(scenario === "combined" ? { subject: "New series", body: { contentType: "text", content: "" }, location: { displayName: "Room B" } } : {}), start: { dateTime: intended.start.toISOString().slice(0, -1), timeZone: "UTC" }, end: { dateTime: intended.end.toISOString().slice(0, -1), timeZone: "UTC" } };
      function applyUpdate() {
        Object.assign(base, payload, { "@odata.etag": 'W/"master-2"' });
        if (scenario.startsWith("rsvp-")) base.attendees[0].status = { response: "notResponded", time: scenario === "rsvp-reset-time" ? "2026-09-22T12:00:00Z" : "4501-01-01T00:00:00Z" };
        if (scenario === "rsvp-reset-role") base.attendees[0].type = "optional";
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
        if (url.pathname === "/v1.0/me") return response({ id: delivery && scenario === "identity" ? "other-user" : "graph-user", mail: "owner@example.test", userPrincipalName: "owner@example.test" });
        if (url.pathname === "/v1.0/me/calendar") return response({ id: "native-calendar", isDefaultCalendar: true, canEdit: true, owner: { address: "owner@example.test" } });
        if (url.pathname === "/v1.0/me/calendars/native-calendar") return response({ id: "native-calendar" });
        if (scenario === "delayed-readback" && writes && !staleRead && url.pathname.endsWith("/instances")) { staleRead = true; return response({ value: originalInstances }); }
        if (url.pathname.endsWith("/instances")) return response({ value: scenario === "partial" ? instances.slice(0, 1) : instances });
        if (init?.method === "PATCH") {
          assert.ok(url.pathname.endsWith("/master"));
          assert.equal(new Headers(init.headers).get("If-Match"), 'W/"master-1"');
          assert.deepEqual(JSON.parse(String(init.body)), payload); writes++;
          const journal = (await db.select().from(eventOutbox).where(eq(eventOutbox.actorID, owner))).find(row => row.status === "attempting")!;
          assert.ok(journal.payload.graphOccurrenceContent?.dispatch?.startedAt, "Permanent marker precedes PATCH");
          if (scenario === "rejected") return response({ error: { code: "ErrorPreconditionFailed" } }, 412);
          if (scenario !== "lost-retained") applyUpdate();
          if (scenario.startsWith("lost-")) throw new Error("Lost response");
          if (scenario === "wrong-time") instances[0].end.dateTime = "2026-09-25T16:00:00.000";
          if (scenario === "wrong-slot") instances[0].originalStart = "2026-09-25T09:00:00Z";
          if (scenario === "wrong-id") instances[0].id = "replacement-id";
          if (scenario === "changed-body") { base.body.content = "Concurrent notes"; for (const instance of instances) instance.body.content = base.body.content; }
          if (scenario === "changed-guest") instances[1].attendees[0].status.response = "declined";
          if (scenario === "rsvp-sibling") instances[1].attendees[0].status.response = "accepted";
          if (scenario === "range-change") base.recurrence.range.endDate = "2026-09-29";
          if (scenario === "pattern-change") base.recurrence.pattern = { type: "weekly", interval: 1, daysOfWeek: ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"], firstDayOfWeek: "sunday" };
          if (scenario === "raw-master-change") base.importance = "high";
          return response(scenario === "bad-response" ? { ...base, id: "wrong-id" } : base);
        }
        const nativeID = url.pathname.split("/").pop();
        const native = nativeID === "master" ? base : instances.find(value => value.id === nativeID);
        return native ? response(native) : response({ error: { code: "ErrorItemNotFound" } }, 404);
      };
      await db.insert(user).values({ id: owner, name: "Fixture", email: `${owner}@example.test` });
      try {
        await db.insert(account).values({ id: randomUUID(), userId: owner, providerId: "microsoft", accountId: "fixture", scope: "Calendars.ReadWrite", refreshToken: "fixture", accessToken: "fixture", accessTokenExpiresAt: new Date(Date.now() + 3_600_000) });
        const calendar = await importExternalCalendar("microsoft", owner, "fixture", "Fixture", { externalId: "native-calendar", name: "Fixture", color: "red" });
        const time = resolveEventTimeEdit(allDay ? { kind: "all-day", startDate: "2026-09-25", endDate: "2026-09-25" } : { kind: "zoned", timeZone: scenario === "non-utc" ? "Europe/Prague" : "UTC", startLocal: scenario === "non-utc" ? "2026-09-25T11:00:00" : "2026-09-25T09:00:00", endLocal: scenario === "non-utc" ? "2026-09-25T12:00:00" : "2026-09-25T10:00:00" });
        const template = EventSchema.parse({ id: randomUUID(), creatorID: owner, title: "Series", organizer: "owner@example.test", color: "red", recurrence: "RRULE:FREQ=DAILY;COUNT=3", isCanceled: false, calendars: [calendar.id], ...time });
        const observation = graphFamilyObservation(graphSeriesFamilyEvidence(base, instances, template, { externalEventId: "master", icalUid: "master-uid" }));
        const canonical = scenario === "canonical" || scenario === "master-target" || (until && !["until", "personal"].includes(scenario));
        if (until && scenario === "canonical") {
          const proof = { baseline: observation, native: base, nativeExceptions: [], template };
          for (const recurrence of ["RRULE:FREQ=DAILY;UNTIL=20260927T080000Z", "RRULE:FREQ=DAILY;UNTIL=20260927T090000Z;UNTIL=20260927T090000Z", "RRULE:FREQ=DAILY;COUNT=3"])
            assert.equal(graphSeriesTimeSupported({ ...proof, baseline: { ...observation, master: { ...observation.master, values: { ...observation.master.values, recurrence } } } }), false, "A cutoff not bound to the native end date and clock cannot be edited");
          for (const range of [{ type: "noEnd" }, { ...base.recurrence.range, endDate: "2026-02-30" }, { ...base.recurrence.range, endDate: "20260927" }])
            assert.equal(graphSeriesTimeSupported({ ...proof, native: { ...base, recurrence: { ...base.recurrence, range } } }), false);
        }
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
        const mapping = oldMappings.find(m => m.externalEventID === (scenario === "master-target" ? "master" : originalInstances[1].id))!;
        const event = (await getEventSnapshot(mapping.eventID))!;
        const state = await getOwnProviderEventObservation(owner, event.id);
        const capability = await observeProviderOrganizer(owner, event.id, state, "series-time");
        ProviderEventStateResponseSchema.parse(capability);
        const unsupported = ["exceptions", "cancelled", "all-day", "non-utc", "flag-off", "partial", "attachments", "conference"].includes(scenario);
        assert.equal(!!capability.outlookSeriesContent?.time, !unsupported, `Time capability: ${mode}`);
        for (const version of ["series-content", "occurrence-time", "occurrence-zone-time", "occurrence-all-day-time"] as const)
          assert.equal((await observeProviderOrganizer(owner, event.id, state, version)).outlookSeriesContent?.time, undefined, "Older strict clients do not receive the v8 field");
        if (["partial", "attachments", "conference"].includes(scenario)) { assert.equal(writes, 0); continue; }
        assert.ok(capability.outlookSeriesContent?.seriesVersion);
        const request = { provider: "microsoft", action: "update", patch, notificationPolicy: "server-invite", operationID: randomUUID(), eventID: event.id, calendarID: calendar.id, scope: "series", expectedRevision: event.revision, expectedStateVersion: state.version, expectedSeriesVersion: capability.outlookSeriesContent.seriesVersion };
        if (unsupported || ["date-change", "overnight", "fraction", "stale-admission"].includes(scenario)) {
          if (scenario === "stale-admission") base["@odata.etag"] = 'W/"changed"';
          await assert.rejects(() => queueProviderOrganizer(owner, request)); assert.equal(writes, 0); continue;
        }
        assert.equal(capability.outlookSeriesContent.time?.startLocal.slice(0, 10), "2026-09-25", "Master date, not the selected later occurrence");
        await queueProviderOrganizer(owner, request);
        assert.equal((await queueProviderOrganizer(owner, request)).replayed, true);
        await assert.rejects(() => queueProviderOrganizer(owner, { ...request, patch: { ...patch, title: "Changed retry" } }));
        const n = observation.instances[0];
        await assert.rejects(() => upsertExternalEvent("microsoft", owner, calendar.id, "native-calendar", n.externalID, { ...n.values, color: "red" }, n.etag, n.icalUid), "Pending time edit fences ordinary pull");
        if (scenario === "stale-delivery") base["@odata.etag"] = 'W/"changed"';
        if (scenario === "sibling-change") { instances[0].type = "exception"; instances[0].subject = "Concurrent change"; base.exceptionOccurrences = [instances[0]]; }
        if (scenario === "flag-delivery") config.api.eventTimeEditsEnabled = false;
        if (scenario === "denied") await db.update(calendarMembers).set({ role: "viewer" }).where(eq(calendarMembers.calendarID, calendar.id));
        if (scenario === "local-race") await db.update(events).set({ revision: sql`${events.revision} + 1` }).where(eq(events.id, event.id));
        if (scenario === "restart" || scenario === "accepted-recovery") {
          const claimed = await claimEventOutbox(request.operationID); assert.ok(claimed);
          assert.equal(await completeEventOutbox(claimed.id, claimed.leaseToken!, null, null), undefined);
          await markGraphOccurrenceContent(claimed);
          await assert.rejects(() => completeGraphOccurrenceContent(claimed, observation));
          if (scenario === "accepted-recovery") { applyUpdate(); await markGraphOccurrenceContent(claimed, true); config.api.eventTimeEditsEnabled = false; }
          await db.update(eventOutbox).set({ status: "unconfirmed", leaseToken: null, leaseUntil: null, nextAttemptAt: new Date(0) }).where(eq(eventOutbox.id, request.operationID));
        }
        delivery = true;
        const run = () => deliverEventOutbox(request.operationID, () => microsoftAdapter);
        const result = await run();
        const succeeds = ["series", "personal", "canonical", "master-target", "combined", "duration", "noop", "accepted-recovery", "rsvp-reset", "delayed-readback", "until", "earlier", "weekly", "gap"].includes(scenario);
        assert.equal(result?.status === "completed", succeeds, `${mode}: ${result?.status} ${result?.errorCode}`);
        assert.equal(writes, ["noop", "accepted-recovery", "restart", "stale-delivery", "sibling-change", "flag-delivery", "local-race", "denied", "identity"].includes(scenario) ? 0 : 1, mode);
        if (!succeeds && writes && scenario !== "rejected" || scenario === "restart") {
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
            const root = rows.find(row => !row.seriesID)!;
            const footprint = finiteSeriesFootprint(EventSchema.parse({ ...root, calendars: [calendar.id] }));
            assert.equal(footprint.length, 3, "Master alone must still generate the final occurrence");
            assert.deepEqual(footprint.map(slot => slot.start.toISOString()), instances.map(item => new Date(item.start.dateTime + "Z").toISOString()), "The canonical rule and instances agree exactly");
            if (until) assert.ok(root.recurrence?.endsWith(`UNTIL=${base.recurrence.range.endDate.replaceAll("-", "")}T${patch.time.startLocal.slice(11).replaceAll(":", "")}Z`), "Rebind to the native cutoff even when it is not an occurrence day");
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
