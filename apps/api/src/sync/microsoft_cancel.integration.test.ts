import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { config } from "@musubi/config";
import { account, db, user, externalEvents, eventOutbox, calendarMembers, createCalendar, externalCalendars, getEventSnapshot, getOwnProviderEventObservation, claimEventOutbox, markProviderOrganizer } from "@musubi/db";
import { observeProviderOrganizer, queueProviderOrganizer } from "./provider_organizer";
import { deliverEventOutbox } from "./event_delivery";
import { microsoftAdapter } from "./adapters/microsoft";

async function main() {
  assert.equal(process.env.ENVIRONMENT, "test");
  const oldFetch = globalThis.fetch, oldFlag = config.api.providerOrganizerEditsEnabled;
  config.api.providerOrganizerEditsEnabled = true;
  try {
    for (const scenario of ["ok", "stale-admission", "stale-delivery", "lost-removed", "lost-retained", "restart", "accepted-recovery", "denied", "identity", "non-organizer", "recurring", "incomplete-guests"] as const) {
      const owner = `graph-cancel-${randomUUID()}`;
      let native: any, cancellations = 0, mode = "ok";
      const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
      globalThis.fetch = async (input, init) => {
        const url = new URL(String(input)); assert.equal(url.origin, "https://graph.microsoft.com"); assert.equal(init?.redirect, "error");
        if (url.pathname === "/v1.0/me") return response({ id: mode === "identity" ? "swapped" : "graph-user", mail: "owner@example.test", userPrincipalName: "owner@example.test" });
        if (url.pathname === "/v1.0/me/calendar") return response({ id: "primary", isDefaultCalendar: true, canEdit: true, owner: { address: "owner@example.test" } });
        if (url.pathname === "/v1.0/me/calendars/primary/events") {
          if (init?.method === "POST") {
            native = { ...JSON.parse(String(init.body)), id: "meeting", iCalUId: "uid", "@odata.etag": 'W/"v1"', type: "singleInstance", recurrence: null, isCancelled: false, isDraft: false, isOrganizer: true, organizer: { emailAddress: { address: "owner@example.test" } }, originalStartTimeZone: "UTC", originalEndTimeZone: "UTC", onlineMeeting: null, onlineMeetingUrl: null, hasAttachments: false };
            return response({ id: native.id }, 201);
          }
          return response({ value: native ? [native] : [] });
        }
        if (url.pathname.endsWith("/cancel")) {
          assert.equal(init?.method, "POST"); assert.deepEqual(JSON.parse(String(init.body)), {});
          assert.equal(new Headers(init?.headers).get("If-Match"), native["@odata.etag"]);
          cancellations++;
          if (mode !== "lost-retained") native = undefined;
          if (mode.startsWith("lost-")) throw new Error("Lost response");
          return new Response(null, { status: 202 });
        }
        assert.equal(url.pathname, "/v1.0/me/calendars/primary/events/meeting");
        return native ? response(native) : response({ error: { code: "ErrorItemNotFound" } }, 404);
      };
      await db.insert(user).values({ id: owner, name: "Fixture", email: `${owner}@example.test` });
      try {
        await db.insert(account).values({ id: randomUUID(), userId: owner, providerId: "microsoft", accountId: "fixture", scope: "Calendars.ReadWrite", accessToken: "fixture", refreshToken: "fixture", accessTokenExpiresAt: new Date(Date.now() + 3_600_000) });
        const calendar = await createCalendar({ creatorID: owner, name: "Fixture", color: "red" });
        await db.insert(externalCalendars).values({ provider: "microsoft", userID: owner, accountID: "fixture", calendarID: calendar.id, externalCalendarID: "primary" });
        const create = { provider: "microsoft", action: "create", notificationPolicy: "server-invite", operationID: randomUUID(), eventID: randomUUID(), calendarID: calendar.id, color: "red", content: { title: "Meeting", description: "Notes", location: "Office" }, time: { kind: "zoned", timeZone: "UTC", startLocal: "2026-09-25T09:00:00", endLocal: "2026-09-25T10:00:00" }, guests: [{ email: "guest@example.test", optional: false }] };
        await queueProviderOrganizer(owner, create);
        assert.equal((await deliverEventOutbox(create.operationID, () => microsoftAdapter))?.status, "completed");
        const event = (await getEventSnapshot(create.eventID))!;
        const observation = await getOwnProviderEventObservation(owner, event.id);
        assert.equal((await observeProviderOrganizer(owner, event.id, observation)).organizerEdit, undefined, "Older clients never receive the new strict provider enum");
        const capability = await observeProviderOrganizer(owner, event.id, observation, true);
        assert.deepEqual(capability.organizerEdit?.actions, ["delete"]);
        assert.equal(capability.organizerEdit?.provider, "microsoft");
        const request = { provider: "microsoft", action: "delete", notificationPolicy: "server-invite", operationID: randomUUID(), eventID: event.id, calendarID: calendar.id, expectedRevision: event.revision, expectedStateVersion: observation.version };
        if (["stale-admission", "non-organizer", "recurring", "incomplete-guests"].includes(scenario)) {
          if (scenario === "stale-admission") native["@odata.etag"] = 'W/"stale"';
          if (scenario === "non-organizer") native.isOrganizer = false;
          if (scenario === "recurring") { native.type = "seriesMaster"; native.recurrence = {}; }
          if (scenario === "incomplete-guests") native["attendees@odata.nextLink"] = "https://graph.microsoft.com/next";
          await assert.rejects(() => queueProviderOrganizer(owner, request)); assert.equal(cancellations, 0); assert.equal((await getEventSnapshot(event.id))!.revision, event.revision); continue;
        }
        await queueProviderOrganizer(owner, request);
        await queueProviderOrganizer(owner, request); // exact replay
        if (scenario === "stale-delivery") native["@odata.etag"] = 'W/"changed"';
        if (scenario === "denied") await db.update(calendarMembers).set({ role: "viewer" }).where(eq(calendarMembers.calendarID, calendar.id));
        mode = scenario;
        if (scenario === "restart" || scenario === "accepted-recovery") {
          const claimed = await claimEventOutbox(request.operationID); assert.ok(claimed);
          await markProviderOrganizer(claimed!);
          if (scenario === "accepted-recovery") { await markProviderOrganizer(claimed!, true); native = undefined; }
          await db.update(eventOutbox).set({ status: "unconfirmed", leaseToken: null, leaseUntil: null, nextAttemptAt: new Date(0) }).where(eq(eventOutbox.id, request.operationID));
        }
        const result = await deliverEventOutbox(request.operationID, () => microsoftAdapter);
        if (scenario === "ok" || scenario === "accepted-recovery") assert.equal(result?.status, "completed", result?.errorCode ?? "");
        else assert.notEqual(result?.status, "completed");
        if (scenario.startsWith("lost-") || scenario === "restart") {
          assert.equal(result?.status, "unconfirmed"); const before = cancellations;
          await db.update(eventOutbox).set({ nextAttemptAt: new Date(0) }).where(eq(eventOutbox.id, request.operationID));
          assert.equal((await deliverEventOutbox(request.operationID, () => microsoftAdapter))?.status, "unconfirmed"); assert.equal(cancellations, before);
        }
        assert.equal(cancellations, ["ok", "lost-removed", "lost-retained"].includes(scenario) ? 1 : 0);
        assert.equal((await db.select().from(externalEvents).where(eq(externalEvents.eventID, event.id))).length, 1, "Cancellation preserves the native mapping for reconciliation");
        console.log("Graph cancellation:", scenario, result?.status);
      } finally { await db.delete(user).where(eq(user.id, owner)); }
    }
  } finally { globalThis.fetch = oldFetch; config.api.providerOrganizerEditsEnabled = oldFlag; }
}
main().then(() => process.exit(0), error => { console.error(error); process.exit(1); });
