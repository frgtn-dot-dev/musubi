import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { config } from "@musubi/config";
import { EventSchema, ProviderEventStateResponseSchema } from "@musubi/types";
import { resolveEventTimeEdit, instantToCivil } from "@musubi/calendar";
import { db, user, account, eventOutbox, externalEvents, importExternalCalendar, upsertExternalEvent, readGraphFamilyContext, replaceGraphFamily, getOwnProviderEventObservation, getEventSnapshot, readOutlookMove, startOutlookMove, outlookMoveResult, graphSeriesTimeChange, planOutlookMove } from "@musubi/db";
import { graphSeriesFamilyEvidence } from "./adapters/microsoft_series_family";
import { graphFamilyObservation } from "./adapters/microsoft_series_delete";
import { microsoftAdapter } from "./adapters/microsoft";
import { observeProviderOrganizer, queueProviderOrganizer } from "./provider_organizer";
import { deliverEventOutbox } from "./event_delivery";
import { observeOutlookMove, outlookMoveChoices, previewOutlookMove, advanceOutlookMove } from "./outlook_moves";
import { handlerLatestOutlookMove, handlerReadOutlookMove, handlerStartOutlookMove } from "../handlers/outlook_moves";

// Independently specified UTC slots for 09:00 local, across northern/southern
// DST and fractional offsets. No fixture expansion uses Musubi's recurrence code.
const cases = [
  { zone: "America/New_York", label: "Eastern Standard Time", date: "2026-10-31", starts: ["2026-10-31T13:00Z", "2026-11-01T14:00Z", "2026-11-02T14:00Z"], until: true },
  { zone: "America/New_York", label: "America/New_York", date: "2026-03-07", starts: ["2026-03-07T14:00Z", "2026-03-08T13:00Z", "2026-03-09T13:00Z"], until: false },
  { zone: "Australia/Sydney", label: "AUS Eastern Standard Time", date: "2026-10-03", starts: ["2026-10-02T23:00Z", "2026-10-03T22:00Z", "2026-10-04T22:00Z"], until: true },
  { zone: "Australia/Lord_Howe", label: "Lord Howe Standard Time", date: "2026-04-04", starts: ["2026-04-03T22:00Z", "2026-04-04T22:30Z", "2026-04-05T22:30Z"], until: false },
  { zone: "Asia/Kathmandu", label: "Asia/Kathmandu", date: "2026-12-30", starts: ["2026-12-30T03:15Z", "2026-12-31T03:15Z", "2027-01-01T03:15Z"], until: true },
  { zone: "Asia/Calcutta", label: "India Standard Time", date: "2026-09-25", starts: ["2026-09-25T03:30Z", "2026-09-26T03:30Z", "2026-09-27T03:30Z"], until: false },
  { zone: "Pacific/Chatham", label: "Chatham Islands Standard Time", date: "2026-09-26", starts: ["2026-09-25T20:15Z", "2026-09-26T19:15Z", "2026-09-27T19:15Z"], until: true },
  { zone: "Pacific/Kiritimati", label: "Line Islands Standard Time", date: "2026-12-30", starts: ["2026-12-29T19:00Z", "2026-12-30T19:00Z", "2026-12-31T19:00Z"], until: false },
  { zone: "Pacific/Honolulu", label: "Hawaiian Standard Time", date: "2026-12-30", starts: ["2026-12-30T19:00Z", "2026-12-31T19:00Z", "2027-01-01T19:00Z"], until: true },
];
async function main() {
  assert.equal(process.env.ENVIRONMENT, "test");
  const oldFetch = globalThis.fetch, oldTZ = process.env.TZ;
  process.env.TZ = "Pacific/Honolulu";
  config.api.providerOrganizerEditsEnabled = config.api.eventTimeEditsEnabled = true;
  try {
    for (const fixture of cases) {
      const owner = `global-zones-${randomUUID()}`, zone = fixture.zone;
      let writes = 0, zoneSupported = true, patchedSeries = false;
      const endpoint = (value: string | Date) => ({ dateTime: new Date(value).toISOString().slice(0, -1), timeZone: "UTC" });
      const shifted = (value: string, minutes: number) => new Date(Date.parse(value) + minutes * 60_000);
      const dates = fixture.starts.map(value => instantToCivil(new Date(value), zone).slice(0, 10));
      const master: any = { id: "master", iCalUId: "master-uid", "@odata.etag": 'W/"master-0"', type: "seriesMaster", subject: "Global planning", body: { contentType: "text", content: "Notes" }, location: { displayName: "Room" }, organizer: { emailAddress: { address: "owner@example.test" } }, isOrganizer: true, isCancelled: false, isDraft: false, isOnlineMeeting: false, onlineMeeting: null, onlineMeetingUrl: null, attendees: [], hasAttachments: false, isAllDay: false, originalStartTimeZone: fixture.label, originalEndTimeZone: fixture.label, start: endpoint(fixture.starts[0]!), end: endpoint(shifted(fixture.starts[0]!, 60)), recurrence: { pattern: { type: "daily", interval: 1 }, range: { startDate: fixture.date, recurrenceTimeZone: fixture.label, ...(fixture.until ? { type: "endDate", endDate: dates[2] } : { type: "numbered", numberOfOccurrences: 3 }) } }, cancelledOccurrences: [], exceptionOccurrences: [], isReminderOn: true, reminderMinutesBeforeStart: 15, showAs: "busy", sensitivity: "normal", responseStatus: { response: "organizer" } };
      const instances: any[] = fixture.starts.map((start, i) => ({ ...structuredClone(master), id: `occ-${i}`, iCalUId: `uid-${i}`, type: "occurrence", seriesMasterId: "master", recurrence: null, originalStart: new Date(start).toISOString(), start: endpoint(start), end: endpoint(shifted(start, 60)) }));
      const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
      globalThis.fetch = async (input, init) => {
        const url = new URL(String(input)); assert.equal(url.origin, "https://graph.microsoft.com");
        if (url.pathname.includes("/outlook/supportedTimeZones")) return response({ value: zoneSupported ? [{ alias: fixture.label === "Asia/Kathmandu" ? "Asia/Katmandu" : fixture.label }] : [] });
        if (url.pathname === "/v1.0/me") return response({ id: "graph-user", mail: "owner@example.test", userPrincipalName: "owner@example.test" });
        if (url.pathname === "/v1.0/me/calendar") return response({ id: "native-calendar", isDefaultCalendar: true, canEdit: true, owner: { address: "owner@example.test" } });
        if (url.pathname === "/v1.0/me/calendars/native-calendar") return response({ id: "native-calendar" });
        if (url.pathname.endsWith("/instances")) return response({ value: instances });
        const id = url.pathname.split("/").pop(), item = id === "master" ? master : instances.find(n => n.id === id);
        if (init?.method === "PATCH") {
          assert.ok(item); assert.equal(new Headers(init.headers).get("If-Match"), item["@odata.etag"]);
          const payload = JSON.parse(String(init.body)); assert.deepEqual(Object.keys(payload).sort(), ["end", "start"]);
          assert.equal(payload.start.timeZone, fixture.label); assert.equal(payload.end.timeZone, fixture.label);
          writes++;
          if (id === "master") {
            assert.equal(writes, 1); patchedSeries = true;
            assert.equal(payload.start.dateTime, fixture.date + "T10:00:00.000");
            assert.equal(payload.end.dateTime, fixture.date + "T11:00:00.000");
            master.start = endpoint(shifted(fixture.starts[0]!, 60)); master.end = endpoint(shifted(fixture.starts[0]!, 120));
            instances.forEach((n, i) => { n.start = endpoint(shifted(fixture.starts[i]!, 60)); n.end = endpoint(shifted(fixture.starts[i]!, 120)); n.originalStart = shifted(fixture.starts[i]!, 60).toISOString(); });
          } else {
            const i = instances.indexOf(item); assert.ok(patchedSeries);
            assert.equal(payload.start.dateTime, dates[i] + "T10:30:00.000"); assert.equal(payload.end.dateTime, dates[i] + "T11:30:00.000");
            item.start = endpoint(shifted(fixture.starts[i]!, 90)); item.end = endpoint(shifted(fixture.starts[i]!, 150)); item.type = "exception";
          }
          for (const n of [master, ...instances]) n["@odata.etag"] = `W/"${n.id}-${writes}"`;
          master.exceptionOccurrences = instances.filter(n => n.type === "exception");
        }
        return item ? response(item) : response({}, 404);
      };
      await db.insert(user).values({ id: owner, name: "Fixture", email: `${owner}@example.test` });
      try {
        await db.insert(account).values({ id: randomUUID(), userId: owner, providerId: "microsoft", accountId: "fixture", scope: "Calendars.ReadWrite", refreshToken: "unused", accessToken: "synthetic", accessTokenExpiresAt: new Date(Date.now() + 3600000) });
        const calendar = await importExternalCalendar("microsoft", owner, "fixture", "Fixture", { externalId: "native-calendar", name: "Fixture", color: "red" });
        const time = resolveEventTimeEdit({ kind: "zoned", timeZone: zone, startLocal: fixture.date + "T09:00:00", endLocal: fixture.date + "T10:00:00" });
        const template = EventSchema.parse({ id: randomUUID(), creatorID: owner, title: master.subject, organizer: "owner@example.test", color: "red", calendars: [calendar.id], recurrence: "RRULE:FREQ=DAILY;COUNT=3", isCanceled: false, ...time });
        const initial = graphFamilyObservation(graphSeriesFamilyEvidence(master, instances, template, { externalEventId: "master", icalUid: "master-uid" }));
        assert.deepEqual(initial.instances.map(n => n.originalStart.value), fixture.starts.map(value => new Date(value).toISOString()));
        if (fixture.until) {
        await upsertExternalEvent("microsoft", owner, calendar.id, "native-calendar", "master", { ...initial.master.values, color: "red" }, master["@odata.etag"], "master-uid", undefined, { timeModel: time.timeModel }, undefined, initial.master.providerState);
        await replaceGraphFamily(await readGraphFamilyContext({ userID: owner, accountID: "fixture", calendarID: calendar.id, externalMasterID: "master" }), initial);
        } else {
          for (const n of initial.instances) await upsertExternalEvent("microsoft", owner, calendar.id, "native-calendar", n.externalID, { ...n.values, color: "red", recurrence: null }, n.etag, n.icalUid, undefined, undefined, { externalSeriesID: "master", originalStart: n.originalStart }, n.providerState, undefined, "master");
        }
        const maps = await db.select().from(externalEvents).where(eq(externalEvents.calendarID, calendar.id));
        const eventID = maps.find(n => n.externalEventID === "occ-0")!.eventID;
        const state = await getOwnProviderEventObservation(owner, eventID);
        const legacy = await observeProviderOrganizer(owner, eventID, state, "occurrence-move");
        assert.equal(legacy.outlookSeriesContent?.time, undefined); assert.equal(legacy.organizerEdit?.timeEdit, undefined); assert.equal(legacy.outlookOccurrenceMove, undefined);
        await assert.rejects(() => outlookMoveChoices(owner, eventID, calendar.id));
        const observed = await observeProviderOrganizer(owner, eventID, state, "global-time-zones");
        ProviderEventStateResponseSchema.parse(observed);
        assert.equal(observed.outlookSeriesContent?.time?.timeZone, zone); assert.equal(observed.organizerEdit?.timeZone, zone); assert.ok(observed.outlookOccurrenceMove);
        const event = (await getEventSnapshot(eventID))!;
        const seriesRequest = { provider: "microsoft", action: "update", scope: "series", notificationPolicy: "server-invite", operationID: randomUUID(), eventID, calendarID: calendar.id, expectedRevision: event.revision, expectedStateVersion: state.version, expectedSeriesVersion: observed.outlookSeriesContent!.seriesVersion, patch: { time: { kind: "zoned", timeZone: zone, startLocal: fixture.date + "T10:00:00", endLocal: fixture.date + "T11:00:00" } } };
        await queueProviderOrganizer(owner, seriesRequest);
        await deliverEventOutbox(seriesRequest.operationID, () => microsoftAdapter);
        let [outbox] = await db.select().from(eventOutbox).where(eq(eventOutbox.id, seriesRequest.operationID));
        assert.equal(outbox!.status, "completed", `Series: ${zone}`);
        assert.equal((await getEventSnapshot(eventID))!.start.toISOString(), shifted(fixture.starts[0]!, 60).toISOString());
        // Local date is invariant even when changing the clock crosses midnight in UTC.
        const proof = await observeOutlookMove(owner, eventID, calendar.id);
        const nearMidnight = graphSeriesTimeChange({ ...proof, request: { ...seriesRequest, patch: { time: { kind: "zoned", timeZone: zone, startLocal: fixture.date + "T00:15:00.000", endLocal: fixture.date + "T00:45:00.000" } } } as any });
        assert.ok(nearMidnight); assert.equal(nearMidnight.slots.length, 3);
        assert.deepEqual(nearMidnight.slots.map(slot => instantToCivil(slot.start, zone).slice(0, 10)), dates);
        // Whole-family gap/fold checks include later occurrences, not just the first.
        if (zone === "America/New_York") {
          const clock = fixture.until ? "01:15:00" : "02:15:00";
          assert.throws(() => graphSeriesTimeChange({ ...proof, request: { ...seriesRequest, patch: { time: { kind: "zoned", timeZone: zone, startLocal: fixture.date + "T" + clock, endLocal: fixture.date + "T03:45:00" } } } as any }));
        }
        const choices = await outlookMoveChoices(owner, eventID, calendar.id, true);
        const request = { operationID: randomUUID(), eventID, calendarID: calendar.id, expectedVersion: choices.version, eventIDs: choices.occurrences.slice(0, 2).map(n => n.eventID), offsetMinutes: 30 };
        assert.throws(() => planOutlookMove(proof, { ...request, expectedVersion: choices.version, offsetMinutes: -720 }, randomUUID), /existing dates/);
        if (zone === "America/New_York") {
          // The second slot falls on the transition day. Its original 10:00
          // cannot be moved into 01:15 (fold) or 02:15 (gap).
          assert.throws(() => planOutlookMove(proof, { ...request, eventIDs: [choices.occurrences[1]!.eventID], offsetMinutes: fixture.until ? -525 : -465 }, randomUUID), /ambiguous or missing/);
        }
        await assert.rejects(() => previewOutlookMove(owner, request));
        const preview = await previewOutlookMove(owner, request, true);
        assert.equal(outlookMoveResult(preview).timeZone, zone);
        // Old clients may not receive or start a non-UTC journal; checks precede mutation.
        const req: any = { user: { id: owner }, params: { operationId: preview.id, eventId: eventID }, query: {} };
        let body: unknown; const res: any = { setHeader() {}, json(value: unknown) { body = value; }, status() { return this; } };
        await handlerLatestOutlookMove(req, res); assert.equal(body, null);
        await assert.rejects(() => handlerReadOutlookMove(req, res)); await assert.rejects(() => handlerStartOutlookMove(req, res));
        assert.equal((await readOutlookMove(owner, preview.id)).status, "preview");
        await startOutlookMove(owner, preview.id);
        for (let i = 0; i < 3; i++) {
          await advanceOutlookMove(preview.id);
          const row = await readOutlookMove(owner, preview.id), item = row.journal.items.find(n => n.status === "queued");
          if (item) await deliverEventOutbox(item.operationID, () => microsoftAdapter);
        }
        const result = outlookMoveResult(await readOutlookMove(owner, preview.id));
        assert.equal(result.status, "completed", `Bulk: ${zone}`); assert.equal(writes, 3);
        result.items.forEach((n, i) => assert.equal(n.newStart, shifted(fixture.starts[i]!, 90).toISOString()));
        assert.equal(master.recurrence.range.recurrenceTimeZone, fixture.label);
        const lastID = maps.find(n => n.externalEventID === "occ-2")!.eventID;
        const lastEvent = (await getEventSnapshot(lastID))!, lastState = await getOwnProviderEventObservation(owner, lastID);
        const lastCapability = await observeProviderOrganizer(owner, lastID, lastState, "global-time-zones");
        const stoppedID = randomUUID();
        await queueProviderOrganizer(owner, { ...seriesRequest, operationID: stoppedID, eventID: lastID, scope: "occurrence", expectedRevision: lastEvent.revision, expectedStateVersion: lastState.version, expectedSeriesVersion: lastCapability.organizerEdit!.seriesVersion, patch: { time: { kind: "zoned", timeZone: zone, startLocal: dates[2] + "T10:30:00", endLocal: dates[2] + "T11:30:00" } } });
        zoneSupported = false;
        await deliverEventOutbox(stoppedID, () => microsoftAdapter);
        const [stopped] = await db.select().from(eventOutbox).where(eq(eventOutbox.id, stoppedID));
        assert.equal(stopped!.status, "cancelled"); assert.equal(writes, 3, "Mailbox support is checked before dispatch");
        const unsupported = await observeProviderOrganizer(owner, eventID, await getOwnProviderEventObservation(owner, eventID), "global-time-zones");
        assert.equal(unsupported.outlookSeriesContent?.time, undefined);
        assert.ok(unsupported.outlookSeriesContent, "Content editing stays available when a mailbox no longer supports the time zone");
        await assert.rejects(() => outlookMoveChoices(owner, eventID, calendar.id, true));
        console.log(`Global Outlook: ${zone}, ${fixture.label}, ${fixture.until ? "endDate" : "numbered"}, series + bulk + compatibility OK`);
      } finally { await db.delete(eventOutbox).where(eq(eventOutbox.actorID, owner)); await db.delete(user).where(eq(user.id, owner)); }
    }
  } finally { globalThis.fetch = oldFetch; if (oldTZ === undefined) delete process.env.TZ; else process.env.TZ = oldTZ; }
}
main().then(() => process.exit(0), error => { console.error(error); process.exit(1); });
