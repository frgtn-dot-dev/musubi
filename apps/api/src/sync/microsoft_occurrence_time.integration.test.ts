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
  config.api.providerOrganizerEditsEnabled = true; config.api.eventTimeEditsEnabled = true;
  try {
    for (const scenario of [ "occurrence", "combined", "personal", "canonical", "canonical-cancelled", "cancelled-before", "all-day", "moved", "boundary", "boundary-rejected", "flag-off", "flag-delivery", "non-utc", "wrong-time", "changed-body", "noop", "stale-admission", "stale-delivery", "sibling-change", "lost-applied", "lost-retained", "restart", "accepted-recovery", "local-race", "denied", "identity", "partial", "survivor-changed", "rejected", "changed-guest", "attachments", "conference", "bad-response", "rsvp-reset", "rsvp-reset-time", "rsvp-reset-role", "prague", "prague-canonical", "prague-spring", "prague-gap", "prague-fold", "prague-midnight", "prague-local-boundary", "prague-wrong-zone", "prague-unsupported", "prague-rsvp-reset", ...["occurrence", "personal", "canonical", "canonical-cancelled", "cancelled-before", "combined", "moved", "one-day", "noop", "boundary", "previous-boundary", "moved-neighbour", "unknown-zone", "conversion", "flag-off", "stale-admission", "rejected", "wrong-time", "changed-body", "lost-applied", "restart", "accepted-recovery", "rsvp-reset", "rsvp-reset-time", "rsvp-reset-role"].map(mode => `date-${mode}`)]) {
      const allDayEdit = scenario.startsWith("date-");
      const mode = allDayEdit ? scenario.slice(5) : scenario;
      const owner = `graph-series-cancel-${randomUUID()}`, allDay = allDayEdit || mode === "all-day";
      let writes = 0, delivery = false;
      const prague = mode.startsWith("prague"), spring = mode === "prague-spring" || mode === "prague-gap";
      const dates = allDayEdit ? ["2026-09-20", "2026-09-23", "2026-09-26"] : prague ? (spring ? ["2026-03-27", "2026-03-29", "2026-03-31"] : ["2026-10-23", "2026-10-25", "2026-10-27"]) : ["2026-09-25", "2026-09-26", "2026-09-27"];
      const zone = prague ? "Europe/Prague" : "UTC";
      const targetID = `occ-${dates[1]!.slice(-2)}`;
      const base: any = { id: "master", iCalUId: "master-uid", "@odata.etag": 'W/"master-1"', createdDateTime: "2026-09-01T10:00:00Z", type: "seriesMaster", subject: "Series", body: { contentType: "text", content: "Notes" }, location: { displayName: "Office" }, organizer: { emailAddress: { address: "owner@example.test" } }, isOrganizer: true, isCancelled: false, isDraft: false, isOnlineMeeting: false, onlineMeeting: null, onlineMeetingUrl: null, attendees: [{ emailAddress: { address: "guest@example.test" }, type: "required", status: { response: "accepted" } }], hasAttachments: false, isAllDay: allDay, originalStartTimeZone: "UTC", originalEndTimeZone: "UTC", start: { dateTime: `2026-09-25T${allDay ? "00" : "09"}:00:00`, timeZone: "UTC" }, end: { dateTime: allDay ? "2026-09-26T00:00:00" : "2026-09-25T10:00:00", timeZone: "UTC" }, recurrence: { pattern: { type: "daily", interval: 1 }, range: { type: "numbered", numberOfOccurrences: 3, startDate: "2026-09-25", recurrenceTimeZone: "UTC" } }, cancelledOccurrences: [], exceptionOccurrences: [], isReminderOn: true, reminderMinutesBeforeStart: 15, showAs: "busy", sensitivity: "normal", responseStatus: { response: "organizer" } };
      if (mode === "non-utc") { base.originalStartTimeZone = base.originalEndTimeZone = base.recurrence.range.recurrenceTimeZone = "Europe/Prague"; }
      if (prague) {
        base.originalStartTimeZone = base.originalEndTimeZone = "Europe/Prague";
        base.recurrence.range.recurrenceTimeZone = "Central Europe Standard Time";
        base.recurrence.range.startDate = dates[0]; base.recurrence.pattern.interval = 2;
        base.start.dateTime = `${dates[0]}T${spring ? "11" : "10"}:00:00`;
        base.end.dateTime = `${dates[0]}T${spring ? "12" : "11"}:00:00`;
      }
      if (allDayEdit) {
        base.start.dateTime = "2026-09-20T00:00:00"; base.end.dateTime = "2026-09-21T00:00:00";
        base.recurrence.range.startDate = dates[0]; base.recurrence.pattern.interval = 3;
      }
      if (mode === "personal") base.attendees = [];
      if (mode === "attachments") base.hasAttachments = true;
      if (mode === "conference") { base.isOnlineMeeting = true; base.onlineMeetingUrl = "https://teams.example.test/meeting"; }
      let instances: any[] = [25, 26, 27].map(day => ({ ...structuredClone(base), id: `occ-${day}`, iCalUId: `uid-${day}`, "@odata.etag": `W/"occ-${day}"`, type: "occurrence", seriesMasterId: "master", originalStart: `2026-09-${day}T${allDay ? "00" : "09"}:00:00Z`, recurrence: null, start: { dateTime: `2026-09-${day}T${allDay ? "00" : "09"}:00:00`, timeZone: "UTC" }, end: { dateTime: allDay ? `2026-09-${day + 1}T00:00:00` : `2026-09-${day}T10:00:00`, timeZone: "UTC" } }));
      if (allDayEdit) instances = dates.map(date => ({ ...structuredClone(base), id: `occ-${date.slice(-2)}`, iCalUId: `uid-${date.slice(-2)}`, "@odata.etag": `W/"occ-${date.slice(-2)}"`, type: "occurrence", seriesMasterId: "master", originalStart: `${date}T00:00:00Z`, recurrence: null,
        start: { dateTime: `${date}T00:00:00`, timeZone: "UTC" }, end: { dateTime: new Date(Date.parse(date) + 86_400_000).toISOString().slice(0, -1), timeZone: "UTC" } }));
      if (prague) instances = dates.map((date, index) => {
        const hour = (spring ? (index === 0 ? 11 : 10) : (index === 0 ? 10 : 11));
        return { ...structuredClone(base), id: `occ-${date.slice(-2)}`, iCalUId: `uid-${date.slice(-2)}`, "@odata.etag": `W/"occ-${date.slice(-2)}"`, type: "occurrence", seriesMasterId: "master", originalStart: `${date}T${hour}:00:00Z`, recurrence: null,
          start: { dateTime: `${date}T${hour}:00:00`, timeZone: "UTC" }, end: { dateTime: `${date}T${hour + 1}:00:00`, timeZone: "UTC" } };
      });
      if (mode === "moved") { instances[1].createdDateTime = "2026-09-22T10:00:00Z"; instances[1].type = "exception"; instances[1].subject = "Moved appointment"; instances[1].start.dateTime = allDayEdit ? "2026-09-24T00:00:00" : "2027-01-10T12:00:00"; instances[1].end.dateTime = allDayEdit ? "2026-09-25T00:00:00" : "2027-01-10T13:00:00"; base.exceptionOccurrences = [...base.exceptionOccurrences.filter((n: any) => n.id !== instances[1].id), instances[1]]; }

      if (mode === "moved-neighbour") {
        instances[2].type = "exception"; instances[2].start.dateTime = "2026-09-25T00:00:00"; instances[2].end.dateTime = "2026-09-26T00:00:00"; base.exceptionOccurrences = [instances[2]];
      }
      if (mode.includes("cancelled")) { instances = instances.slice(0, 2); base.cancelledOccurrences = ["already-cancelled-slot"]; }
      const originalInstances = structuredClone(instances);
      const patch: any = { ...(mode === "combined" ? { title: "Moved appointment", description: null, location: "Room B" } : {}), time: { kind: "zoned", timeZone: "UTC", startLocal: mode === "noop" ? "2026-09-26T09:00:00" : "2026-09-26T13:00:00", endLocal: mode === "noop" ? "2026-09-26T10:00:00" : "2026-09-26T14:00:00" } };
      if (prague) {
        patch.time = { kind: "zoned", timeZone: zone, startLocal: `${dates[1]}T14:00:00`, endLocal: `${dates[1]}T15:00:00` };
        if (mode === "prague-fold" || mode === "prague-gap") patch.time.startLocal = `${dates[1]}T02:30:00`;
        if (mode === "prague-midnight") { patch.time.startLocal = "2026-10-24T00:30:00"; patch.time.endLocal = "2026-10-24T01:30:00"; }
        if (mode === "prague-local-boundary") { patch.time.startLocal = "2026-10-27T00:30:00"; patch.time.endLocal = "2026-10-27T01:30:00"; }
        if (mode === "prague-wrong-zone") patch.time.timeZone = "UTC";
      }
      if (allDayEdit) patch.time = { kind: "all-day", startDate: mode === "noop" ? "2026-09-23" : "2026-09-24", endDate: mode === "noop" ? "2026-09-23" : mode === "one-day" ? "2026-09-24" : "2026-09-25" };
      const intended = resolveEventTimeEdit(patch.time as any);
      const payload = { ...(mode === "combined" ? { subject: "Moved appointment", body: { contentType: "text", content: "" }, location: { displayName: "Room B" } } : {}), start: { dateTime: intended.start.toISOString().slice(0, -1), timeZone: "UTC" }, end: { dateTime: new Date(intended.end.getTime() + (allDayEdit ? 86_400_000 : 0)).toISOString().slice(0, -1), timeZone: "UTC" } };
      const requestPayload = allDayEdit ? payload : { ...payload, start: { dateTime: patch.time.startLocal + ".000", timeZone: patch.time.timeZone }, end: { dateTime: patch.time.endLocal + ".000", timeZone: patch.time.timeZone } };
      function applyUpdate() {
        Object.assign(instances[1], payload, { createdDateTime: mode === "moved" ? instances[1].createdDateTime : "2026-09-22T10:00:00Z", type: "exception", "@odata.etag": 'W/"occ-updated"' });
        if (mode.includes("rsvp-reset")) {
          instances[1].attendees[0].status = { response: "notResponded", time: mode === "rsvp-reset-time" ? "2026-09-22T12:00:00Z" : "4501-01-01T00:00:00Z" };
          if (mode === "rsvp-reset-role") instances[1].attendees[0].type = "optional";
        }
        base.exceptionOccurrences = [...base.exceptionOccurrences.filter((n: any) => n.id !== instances[1].id), instances[1]]; base["@odata.etag"] = 'W/"master-2"';
      }
      const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
      globalThis.fetch = async (input, init) => {
        const url = new URL(String(input)); assert.equal(url.origin, "https://graph.microsoft.com"); assert.equal(init?.redirect, "error");
        if (url.pathname === "/v1.0/me") return response({ id: delivery && mode === "identity" ? "other-user" : "graph-user", mail: "owner@example.test", userPrincipalName: "owner@example.test" });
        if (url.pathname === "/v1.0/me/calendar") return response({ id: "native-calendar", isDefaultCalendar: true, canEdit: true, owner: { address: "owner@example.test" } });
        if (url.pathname === "/v1.0/me/calendars/native-calendar") return response({ id: "native-calendar" });
        if (url.pathname.includes("/outlook/supportedTimeZones")) return response({ value: mode === "prague-unsupported" ? [] : [{ alias: "Europe/Prague" }] });
        if (url.pathname.endsWith("/instances")) return response({ value: mode === "partial" ? instances.slice(0, 1) : instances });
        if (init?.method === "PATCH") {
          assert.ok(url.pathname.endsWith("/" + targetID));
          assert.equal(new Headers(init.headers).get("If-Match"), `W/"${targetID}"`);
          assert.deepEqual(JSON.parse(String(init.body)), requestPayload); writes++;
          const journal = (await db.select().from(eventOutbox).where(eq(eventOutbox.actorID, owner))).find(row => row.status === "attempting")!;
          assert.ok(journal.payload.graphOccurrenceContent?.dispatch?.startedAt, "Permanent marker precedes PATCH");
          if (mode === "boundary-rejected") return response({ error: { code: "ErrorOccurrenceCrossingBoundary" } }, 400);
          if (mode === "rejected") return response({ error: { code: "ErrorPreconditionFailed" } }, 412);
          if (mode !== "lost-retained") applyUpdate();
          if (mode.startsWith("lost-")) throw new Error("Lost response");
          if (mode === "survivor-changed") { instances[0].type = "exception"; instances[0].subject = "A concurrent edit"; base.exceptionOccurrences.push(instances[0]); }
          if (mode === "wrong-time") instances[1].start.dateTime = "2026-09-26T16:00:00";
          if (mode === "changed-body") instances[1].body.content = "Unrelated changed notes";
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
        const time = resolveEventTimeEdit(allDay ? { kind: "all-day", startDate: allDayEdit ? dates[0]! : "2026-09-25", endDate: allDayEdit ? dates[0]! : "2026-09-25" } : { kind: "zoned", timeZone: mode === "non-utc" ? "Europe/Prague" : "UTC", startLocal: mode === "non-utc" ? "2026-09-25T11:00:00" : "2026-09-25T09:00:00", endLocal: mode === "non-utc" ? "2026-09-25T12:00:00" : "2026-09-25T10:00:00" });
        if (prague) Object.assign(time, resolveEventTimeEdit({ kind: "zoned", timeZone: zone, startLocal: `${dates[0]}T12:00:00`, endLocal: `${dates[0]}T13:00:00` }));
        const template = EventSchema.parse({ id: randomUUID(), creatorID: owner, title: "Series", organizer: "owner@example.test", color: "red", recurrence: allDayEdit ? "RRULE:FREQ=DAILY;INTERVAL=3;COUNT=3" : prague ? "RRULE:FREQ=DAILY;INTERVAL=2;COUNT=3" : "RRULE:FREQ=DAILY;COUNT=3", isCanceled: false, calendars: [calendar.id], ...time });
        const observation = graphFamilyObservation(graphSeriesFamilyEvidence(base, instances, template, { externalEventId: "master", icalUid: "master-uid" }));
        if (mode.startsWith("canonical") || mode === "prague-canonical") {
          await upsertExternalEvent("microsoft", owner, calendar.id, "native-calendar", "master", { ...observation.master.values, color: "red" }, base["@odata.etag"], "master-uid", undefined, { timeModel: time.timeModel }, undefined, observation.master.providerState);
          const address = { userID: owner, accountID: "fixture", calendarID: calendar.id, externalMasterID: "master" };
          await replaceGraphFamily(await readGraphFamilyContext(address), observation);
        } else {
          for (const item of originalInstances) {
            const n = toNormalized(item);
            await upsertExternalEvent("microsoft", owner, calendar.id, "native-calendar", n.externalId, { title: n.title, start: n.start, end: n.end, isAllDay: n.isAllDay, description: n.description, location: n.location, organizer: n.organizer ?? "", recurrence: null, url: n.url, color: "red" }, n.etag, n.icalUid, undefined, undefined, { externalSeriesID: "master", originalStart: allDayEdit ? { kind: "date", value: item.originalStart.slice(0, 10) } : { kind: "instant", value: new Date(item.originalStart).toISOString() } }, n.providerState, undefined, "master");
          }
        }
        const mapping = (await db.select().from(externalEvents).where(eq(externalEvents.calendarID, calendar.id))).find(m => m.externalEventID === targetID)!;
        const event = (await getEventSnapshot(mapping.eventID))!;
        const state = await getOwnProviderEventObservation(owner, event.id);
        if (mode === "unknown-zone") for (const item of [base, ...instances]) item.originalStartTimeZone = item.originalEndTimeZone = "Europe/Prague";
        assert.equal((await observeProviderOrganizer(owner, event.id, state, true)).outlookCancellation, undefined, "v1 clients never receive a new strict response field");
        assert.equal((await observeProviderOrganizer(owner, event.id, state, "content")).organizerEdit?.timeEdit, undefined, "v3 never enables time");
        assert.equal((await observeProviderOrganizer(owner, event.id, state, "series-content")).organizerEdit?.timeEdit, undefined, "v4 never enables time");
        const legacy = await observeProviderOrganizer(owner, event.id, state, "occurrence-time");
        assert.equal(legacy.organizerEdit?.timeZone, undefined, "v5 cannot receive the strict v6 field");
        if (prague) assert.equal(legacy.organizerEdit?.timeEdit, undefined);
        const v6 = await observeProviderOrganizer(owner, event.id, state, "occurrence-zone-time");
        assert.equal(v6.organizerEdit?.timeKind, undefined, "v6 cannot receive the strict v7 field");
        if (allDayEdit) { assert.equal(v6.organizerEdit?.timeEdit, undefined); assert.equal(legacy.organizerEdit?.timeEdit, undefined); }
        const capability = allDayEdit ? await observeProviderOrganizer(owner, event.id, state, "occurrence-all-day-time") : prague ? await observeProviderOrganizer(owner, event.id, state, "occurrence-zone-time") : legacy;
        if (["partial", "attachments", "conference", "prague-unsupported", "unknown-zone"].includes(mode)) { assert.equal(capability.organizerEdit, undefined); assert.equal(writes, 0); continue; }
        ProviderEventStateResponseSchema.parse(capability);
        assert.equal(capability.organizerEdit?.timeEdit, (allDay && !allDayEdit || mode === "non-utc") ? undefined : true);
        assert.equal(capability.organizerEdit?.timeKind, allDayEdit ? "all-day" : undefined);
        assert.ok(capability.organizerEdit?.seriesVersion, `No capability: ${mode}`);
        assert.equal((await observeProviderOrganizer(owner, event.id, state, "series")).organizerEdit, undefined, "v2 clients do not receive the v3 occurrence capability");
        const request = { provider: "microsoft", action: "update", patch, notificationPolicy: "server-invite", operationID: randomUUID(), eventID: event.id, calendarID: calendar.id, scope: "occurrence", expectedRevision: event.revision, expectedStateVersion: state.version, expectedSeriesVersion: capability.organizerEdit.seriesVersion };
        if (allDay && !allDayEdit || ["conversion", "previous-boundary", "moved-neighbour", "non-utc", "boundary", "flag-off", "prague-gap", "prague-fold", "prague-local-boundary", "prague-wrong-zone"].includes(mode)) {
          if (allDayEdit && mode === "conversion") request.patch.time = { kind: "zoned", timeZone: "UTC", startLocal: "2026-09-24T00:00:00", endLocal: "2026-09-25T00:00:00" };
          if (allDayEdit && mode === "previous-boundary") request.patch.time = { kind: "all-day", startDate: "2026-09-20", endDate: "2026-09-21" };
          if (allDayEdit && mode === "boundary") request.patch.time.endDate = "2026-09-26";
          if (!allDayEdit && mode === "boundary") { request.patch.time.startLocal = "2026-09-27T13:00:00"; request.patch.time.endLocal = "2026-09-27T14:00:00"; }
          if (mode === "flag-off") { config.api.eventTimeEditsEnabled = false; assert.equal((await observeProviderOrganizer(owner, event.id, state, "occurrence-time")).organizerEdit?.timeEdit, undefined); }
          await assert.rejects(() => queueProviderOrganizer(owner, request));
          assert.equal(writes, 0);
          config.api.eventTimeEditsEnabled = true;
          continue;
        }
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
        if (mode === "flag-delivery") config.api.eventTimeEditsEnabled = false;
        delivery = true;
        const run = () => deliverEventOutbox(request.operationID, () => microsoftAdapter);
        const result = await run();
        config.api.eventTimeEditsEnabled = true;
        const succeeds = ["one-day", "occurrence", "combined", "personal", "canonical", "canonical-cancelled", "cancelled-before", "all-day", "moved", "noop", "accepted-recovery", "rsvp-reset", "prague", "prague-canonical", "prague-spring", "prague-midnight", "prague-rsvp-reset"].includes(mode);
        assert.equal(result?.status === "completed", succeeds, `${scenario}: ${result?.status} ${result?.errorCode}`);
        assert.equal(writes, ["one-day", "occurrence", "combined", "personal", "canonical", "canonical-cancelled", "cancelled-before", "all-day", "moved", "boundary-rejected", "wrong-time", "changed-body", "lost-applied", "lost-retained", "survivor-changed", "changed-guest", "rejected", "bad-response", "rsvp-reset", "rsvp-reset-time", "rsvp-reset-role", "prague", "prague-canonical", "prague-spring", "prague-midnight", "prague-rsvp-reset"].includes(mode) ? 1 : 0);
        if (["lost-applied", "lost-retained", "restart", "survivor-changed", "changed-guest", "wrong-time", "changed-body", "bad-response", "rsvp-reset-time", "rsvp-reset-role"].includes(mode)) {
          const count = writes;
          await requestEventDeliveryRetry(owner, event.id, request.operationID);
          await db.update(eventOutbox).set({ nextAttemptAt: new Date(0) }).where(eq(eventOutbox.id, request.operationID));
          assert.notEqual((await run())?.status, "completed"); assert.equal(writes, count, "Retries must never send another update");
        }
        if (succeeds) {
          const rows = await db.select().from(events).where(eq(events.creatorID, owner));
          const visible = expandRecurringEvents(rows.filter(e => !e.deletedAt), new Date("2026-03-01Z"), new Date("2027-02-01Z"), { consumerTimeZone: "UTC" });
          assert.equal(visible.length, mode.includes("cancelled") ? 2 : 3);
          const edited = (await getEventSnapshot(event.id))!;
          for (const field of ["seriesID", "originalStart", "recurrence"] as const) assert.deepEqual(edited[field], event[field], field);
          for (const field of ["title", "description", "location"] as const) assert.deepEqual(edited[field], patch[field] !== undefined ? patch[field] : event[field], field);
          assert.equal(edited.start.toISOString(), payload.start.dateTime + "Z");
          assert.equal(edited.end.toISOString(), intended.end.toISOString());
          if (mode !== "noop") assert.equal(edited.timeModel?.kind, allDayEdit ? "all-day" : "zoned");
          if (prague) assert.equal(edited.timeModel?.kind === "zoned" && edited.timeModel.timeZone, zone);
          if (mode.includes("rsvp-reset")) assert.equal((await getOwnProviderEventObservation(owner, event.id)).state?.attendees[0]?.response, "notResponded");
          const siblings = rows.filter(e => e.id !== event.id);
          assert.ok(siblings.every(e => e.start.getTime() !== edited.start.getTime()));
        }
        if (["occurrence", "canonical", "rejected", "boundary-rejected"].includes(mode)) {
          const next = (await getEventSnapshot(event.id))!;
          const nextState = await getOwnProviderEventObservation(owner, event.id);
          const refreshed = await observeProviderOrganizer(owner, event.id, nextState, "content");
          assert.ok(refreshed.organizerEdit?.seriesVersion, "Completed or definitely rejected updates allow a fresh edit");
          await queueProviderOrganizer(owner, { ...request, operationID: randomUUID(), expectedRevision: next.revision, expectedStateVersion: nextState.version, expectedSeriesVersion: refreshed.organizerEdit.seriesVersion });
        }
        console.log("Graph occurrence time:", scenario, result?.status);
      } finally { await db.delete(user).where(eq(user.id, owner)); }
    }
  } finally { globalThis.fetch = oldFetch; config.api.providerOrganizerEditsEnabled = oldFlag; config.api.eventTimeEditsEnabled = oldTime; }
}
main().then(() => process.exit(0), error => { console.error(error); process.exit(1); });
