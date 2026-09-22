import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { config } from "@musubi/config";
import { MicrosoftOrganizerRequestSchema } from "@musubi/types";
import { account, db, user, events, externalEvents, eventOutbox, calendarMembers, createCalendar, externalCalendars, getEventSnapshot, getOwnProviderEventObservation, claimEventOutbox, markProviderOrganizer, upsertExternalEvent, completeProviderOrganizer } from "@musubi/db";
import { observeProviderOrganizer, queueProviderOrganizer } from "./provider_organizer";
import { deliverEventOutbox } from "./event_delivery";
import { microsoftAdapter, toNormalized } from "./adapters/microsoft";

async function main() {
  assert.equal(process.env.ENVIRONMENT, "test");
  const oldFetch = globalThis.fetch, oldFlag = config.api.providerOrganizerEditsEnabled;
  config.api.providerOrganizerEditsEnabled = true;
  try {
    for (const scenario of ["ok", "clear", "all-day", "noop", "stale-admission", "projection-mismatch", "stale-delivery", "race412", "lost-applied", "lost-retained", "restart", "accepted-recovery", "accepted-changed", "denied", "identity", "non-organizer", "recurring", "partial", "conference", "attachments", "source-race", "missing", "bad-response-id", "became-online", "source-before-dispatch", "changed-shape-after-write"] as const) {
      const owner = `graph-content-${randomUUID()}`;
      let native: any, patches = 0, mode = "ok", operationID = "";
      const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
      const expectedPatch = scenario === "clear" ? { body: { contentType: "text", content: "" }, location: { displayName: "" } } : { subject: scenario === "noop" ? "Meeting" : "Updated meeting" };
      globalThis.fetch = async (input, init) => {
        const url = new URL(String(input)); assert.equal(url.origin, "https://graph.microsoft.com"); assert.equal(init?.redirect, "error");
        if (url.pathname === "/v1.0/me") return response({ id: mode === "identity" ? "swapped" : "graph-user", mail: "owner@example.test", userPrincipalName: "owner@example.test" });
        if (url.pathname === "/v1.0/me/calendar") return response({ id: "primary", isDefaultCalendar: true, canEdit: true, owner: { address: "owner@example.test" } });
        if (url.pathname === "/v1.0/me/calendars/primary/events") {
          if (init?.method === "POST") {
            native = { ...JSON.parse(String(init.body)), id: "meeting", iCalUId: "uid", "@odata.etag": 'W/"v1"', type: "singleInstance", recurrence: null, isCancelled: false, isDraft: false, isOrganizer: true, organizer: { emailAddress: { address: "owner@example.test" } }, originalStartTimeZone: "UTC", originalEndTimeZone: "UTC", onlineMeeting: null, onlineMeetingUrl: null, hasAttachments: false, isReminderOn: true, reminderMinutesBeforeStart: 15, showAs: "busy", sensitivity: "private", preserved: { value: "untouched" }, locations: [{ displayName: "Office", locationType: "default" }] };
            return response({ id: native.id }, 201);
          }
          return response({ value: native ? [native] : [] });
        }
        assert.equal(url.pathname, "/v1.0/me/calendars/primary/events/meeting");
        if (init?.method === "PATCH") {
          patches++;
          const [row] = await db.select().from(eventOutbox).where(eq(eventOutbox.id, operationID));
          assert.ok(row.payload.organizer?.dispatch, "Marker must be durable before PATCH");
          assert.equal(new Headers(init.headers).get("If-Match"), row.expectedEtag);
          assert.deepEqual(JSON.parse(String(init.body)), expectedPatch, "Only requested fields may leave Musubi");
          if (mode === "race412") { native.subject = "Concurrent edit"; native["@odata.etag"] = 'W/"concurrent"'; return response({ error: { code: "ErrorIrresolvableConflict" } }, 412); }
          if (mode !== "lost-retained") {
            Object.assign(native, expectedPatch, { "@odata.etag": 'W/"v2"', changeKey: "v2", lastModifiedDateTime: "2026-09-22T10:00:00Z", bodyPreview: "Changed server preview" });
            if (scenario === "clear") { native.location.locationType = "default"; native.locations = []; }
          }
          if (mode.startsWith("lost-")) throw new Error("Lost response");
          if (mode === "source-race") await db.update(events).set({ revision: sql`${events.revision} + 1` }).where(eq(events.id, row.eventID));
          const result = structuredClone(native);
          if (mode === "accepted-changed") native.preserved.value = "Concurrent change";
          if (mode === "changed-shape-after-write") native.isOnlineMeeting = true;
          if (mode === "bad-response-id") result.id = "other";
          return response(result);
        }
        return native ? response(native) : response({ error: { code: "ErrorItemNotFound" } }, 404);
      };
      await db.insert(user).values({ id: owner, name: "Fixture", email: `${owner}@example.test` });
      try {
        await db.insert(account).values({ id: randomUUID(), userId: owner, providerId: "microsoft", accountId: "fixture", scope: "Calendars.ReadWrite", accessToken: "fixture", refreshToken: "fixture", accessTokenExpiresAt: new Date(Date.now() + 3_600_000) });
        const calendar = await createCalendar({ creatorID: owner, name: "Fixture", color: "red" });
        await db.insert(externalCalendars).values({ provider: "microsoft", userID: owner, accountID: "fixture", calendarID: calendar.id, externalCalendarID: "primary" });
        const create = { provider: "microsoft", action: "create", notificationPolicy: "server-invite", operationID: randomUUID(), eventID: randomUUID(), calendarID: calendar.id, color: "red", content: { title: "Meeting", description: "Notes", location: "Office" }, time: scenario === "all-day" ? { kind: "all-day", startDate: "2026-09-25", endDate: "2026-09-25" } : { kind: "zoned", timeZone: "UTC", startLocal: "2026-09-25T09:00:00", endLocal: "2026-09-25T10:00:00" }, guests: [{ email: "guest@example.test", optional: false }] };
        await queueProviderOrganizer(owner, create);
        assert.equal((await deliverEventOutbox(create.operationID, () => microsoftAdapter))?.status, "completed");
        const originalTime = { start: structuredClone(native.start), end: structuredClone(native.end), isAllDay: native.isAllDay };
        const event = (await getEventSnapshot(create.eventID))!;
        const observation = await getOwnProviderEventObservation(owner, event.id);
        assert.equal((await observeProviderOrganizer(owner, event.id, observation)).organizerEdit, undefined);
        assert.deepEqual((await observeProviderOrganizer(owner, event.id, observation, true)).organizerEdit?.actions, ["delete"], "v1 clients retain their cancellation contract");
        assert.deepEqual((await observeProviderOrganizer(owner, event.id, observation, "series")).organizerEdit?.actions, ["update", "delete"]);
        const request = { provider: "microsoft", action: "update", notificationPolicy: "server-invite", operationID: randomUUID(), eventID: event.id, calendarID: calendar.id, expectedRevision: event.revision, expectedStateVersion: observation.version, patch: scenario === "clear" ? { description: null, location: null } : { title: scenario === "noop" ? "Meeting" : "Updated meeting" } };
        operationID = request.operationID;
        for (const forbidden of [{ time: create.time }, { guests: create.guests }, { recurrence: "RRULE:FREQ=DAILY" }, { color: "red" }]) assert.equal(MicrosoftOrganizerRequestSchema.safeParse({ ...request, patch: forbidden }).success, false);
        if (["stale-admission", "projection-mismatch", "non-organizer", "recurring", "partial", "conference", "attachments"].includes(scenario)) {
          if (scenario === "stale-admission") native["@odata.etag"] = 'W/"stale"';
          if (scenario === "projection-mismatch") native.subject = "Different content without mapping refresh";
          if (scenario === "non-organizer") native.isOrganizer = false;
          if (scenario === "recurring") { native.type = "seriesMaster"; native.recurrence = {}; }
          if (scenario === "partial") native["attendees@odata.nextLink"] = "https://graph.microsoft.com/next";
          if (scenario === "conference") native.isOnlineMeeting = true;
          if (scenario === "attachments") native.hasAttachments = true;
          assert.equal((await observeProviderOrganizer(owner, event.id, observation, "series")).organizerEdit?.actions?.includes("update") ?? false, false);
          await assert.rejects(() => queueProviderOrganizer(owner, request)); assert.equal(patches, 0); assert.equal((await getEventSnapshot(event.id))!.revision, event.revision); continue;
        }
        await queueProviderOrganizer(owner, request);
        assert.equal((await queueProviderOrganizer(owner, request)).replayed, true);
        await assert.rejects(() => queueProviderOrganizer(owner, { ...request, patch: { title: "Reused identity" } }));
        if (scenario === "stale-delivery") native["@odata.etag"] = 'W/"changed"';
        if (scenario === "denied") await db.update(calendarMembers).set({ role: "viewer" }).where(eq(calendarMembers.calendarID, calendar.id));
        if (scenario === "missing") native = undefined;
        if (scenario === "became-online") native.isOnlineMeeting = true;
        if (scenario === "source-before-dispatch") await db.update(events).set({ title: "Newer local title", revision: sql`${events.revision} + 1` }).where(eq(events.id, event.id));
        mode = scenario;
        if (scenario === "restart" || scenario === "accepted-recovery") {
          const claimed = await claimEventOutbox(request.operationID); assert.ok(claimed);
          await markProviderOrganizer(claimed!);
          if (scenario === "accepted-recovery") { await markProviderOrganizer(claimed!, true); Object.assign(native, expectedPatch, { "@odata.etag": 'W/"v2"' }); }
          await db.update(eventOutbox).set({ status: "unconfirmed", leaseToken: null, leaseUntil: null, nextAttemptAt: new Date(0) }).where(eq(eventOutbox.id, request.operationID));
        }
        const result = await deliverEventOutbox(request.operationID, () => microsoftAdapter);
        if (["ok", "clear", "all-day", "accepted-recovery"].includes(scenario)) {
          assert.equal(result?.status, "completed", result?.errorCode ?? "");
          const [mapping] = await db.select().from(externalEvents).where(eq(externalEvents.eventID, event.id));
          assert.equal(mapping.etag, 'W/"v2"');
          assert.deepEqual(mapping.providerState?.reminders, { provider: "microsoft", isOn: true, minutesBeforeStart: 15 });
        } else if (scenario === "noop") assert.equal(result?.status, "not-needed");
        else assert.notEqual(result?.status, "completed");
        if (["lost-applied", "lost-retained", "restart", "bad-response-id", "accepted-changed", "changed-shape-after-write"].includes(scenario)) {
          assert.equal(result?.status, "unconfirmed"); const before = patches;
          await db.update(eventOutbox).set({ nextAttemptAt: new Date(0) }).where(eq(eventOutbox.id, request.operationID));
          assert.equal((await deliverEventOutbox(request.operationID, () => microsoftAdapter))?.status, "unconfirmed"); assert.equal(patches, before);
        }
        if (scenario === "lost-applied") {
          await db.update(eventOutbox).set({ nextAttemptAt: new Date(0) }).where(eq(eventOutbox.id, request.operationID));
          const claimed = await claimEventOutbox(request.operationID); assert.ok(claimed);
          await assert.rejects(() => completeProviderOrganizer(claimed!, { id: native.id, etag: native["@odata.etag"], iCalUID: native.iCalUId, state: toNormalized(native).providerState! }), /acceptance is unavailable/);
        }
        assert.equal(patches, ["ok", "clear", "all-day", "race412", "lost-applied", "lost-retained", "accepted-changed", "source-race", "bad-response-id", "changed-shape-after-write"].includes(scenario) ? 1 : 0);
        if (native) assert.deepEqual({ start: native.start, end: native.end, isAllDay: native.isAllDay }, originalTime);
        if (["stale-delivery", "identity", "denied", "missing", "race412", "became-online", "source-before-dispatch"].includes(scenario)) {
          assert.equal(result?.status, "cancelled");
          assert.equal((await getEventSnapshot(event.id))!.title, scenario === "source-before-dispatch" ? "Newer local title" : event.title, "Only restore the rejected optimistic revision");
          if (["stale-delivery", "race412"].includes(scenario)) {
            mode = "ok";
            const n = toNormalized(native);
            await upsertExternalEvent("microsoft", owner, calendar.id, "primary", n.externalId, { title: n.title, description: n.description, location: n.location, start: n.start, end: n.end, isAllDay: n.isAllDay, color: "red", organizer: n.organizer ?? "", recurrence: null, url: n.url }, n.etag, n.icalUid, undefined, undefined, undefined, n.providerState);
            const fresh = (await getEventSnapshot(event.id))!, state = await getOwnProviderEventObservation(owner, event.id);
            const replacement = { ...request, operationID: randomUUID(), expectedRevision: fresh.revision, expectedStateVersion: state.version };
            operationID = replacement.operationID;
            await queueProviderOrganizer(owner, replacement);
            const [queued] = await db.select().from(eventOutbox).where(eq(eventOutbox.id, operationID));
            assert.notEqual(queued.predecessorID, request.operationID, "Definite rejection cannot block a fresh request");
            assert.equal((await deliverEventOutbox(operationID, () => microsoftAdapter))?.status, "completed", "A fresh edit succeeds after syncing the rejected version");
          }
        }
        console.log("Graph meeting content:", scenario, result?.status);
      } finally { await db.delete(user).where(eq(user.id, owner)); }
    }
  } finally { globalThis.fetch = oldFetch; config.api.providerOrganizerEditsEnabled = oldFlag; }
}
main().then(() => process.exit(0), error => { console.error(error); process.exit(1); });
