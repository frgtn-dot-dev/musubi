import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { config } from "@musubi/config";
import { account, calendarMembers, createCalendar, db, eventOutbox, events, eventUsers, externalCalendars, externalEvents, getEventSnapshot, getOrganizerTimeEventIDs, upsertExternalEvent, claimEventOutbox, markProviderOrganizer, requestEventDeliveryRetry, user } from "@musubi/db";
import { queueProviderOrganizer } from "./provider_organizer";
import { deliverEventOutbox } from "./event_delivery";
import { microsoftAdapter } from "./adapters/microsoft";
async function main() {
  assert.equal(process.env.ENVIRONMENT, "test");
  const oldFetch = globalThis.fetch, oldFlag = config.api.providerOrganizerEditsEnabled;
  config.api.providerOrganizerEditsEnabled = true;
  let native: any, posts = 0, hook: (() => Promise<void>) | undefined, mode = "ok";
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input)); assert.equal(url.origin, "https://graph.microsoft.com", "Only intercepted Graph traffic");
    const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
    if (url.pathname === "/v1.0/me") return response({ id: mode === "swapped" ? "other-graph-id" : "graph-object-id", mail: "owner@example.test", userPrincipalName: "owner@example.test" });
    if (url.pathname === "/v1.0/me/calendar") return response({ id: "primary", isDefaultCalendar: true, canEdit: true, owner: { address: "owner@example.test" } });
    assert.equal(url.pathname, "/v1.0/me/calendars/primary/events");
    if (init?.method === "POST") {
      posts++; const body = JSON.parse(String(init.body));
      native = { ...body, id: "native", iCalUId: "uid", "@odata.etag": 'W/"v1"', type: "singleInstance", originalStartTimeZone: "UTC", originalEndTimeZone: "UTC", isCancelled: false, isDraft: false, isOrganizer: true, recurrence: null, organizer: { emailAddress: { address: "owner@example.test" } }, onlineMeeting: null, onlineMeetingUrl: null, hasAttachments: false };
      if (mode === "after-post" && hook) { const action = hook; hook = undefined; await action(); }
      if (mode === "lost") throw new Error("Lost response");
      return response({ id: "native" }, 201);
    }
    if (mode === "answered" && native) native.attendees = native.attendees.map((guest: any) => ({ ...guest, status: { response: "accepted", time: "2026-09-01T12:00:00Z" } }));
    if (mode === "before-post" && hook) { const action = hook; hook = undefined; await action(); }
    return response({ value: native ? [native] : [] });
  };
  try {
    for (const scenario of ["create", "answered", "swapped", "lost", "restart", "role-before", "generation-before", "generation-after", "identity-replay", "pull-before-ack", "scope"] as const) {
      const owner = `graph-organizer-${randomUUID()}`;
      await db.insert(user).values({ id: owner, email: `${owner}@example.test`, name: "Owner" });
      native = undefined; posts = 0; hook = undefined; mode = "ok";
      try {
        await db.insert(account).values({ id: randomUUID(), userId: owner, providerId: "microsoft", accountId: "fixture", scope: scenario === "scope" ? "Calendars.Read" : "Calendars.ReadWrite", accessToken: "fixture", refreshToken: "fixture", accessTokenExpiresAt: new Date(Date.now() + 3600000) });
        const calendar = await createCalendar({ creatorID: owner, name: "Primary", color: "red" });
        await db.insert(externalCalendars).values({ provider: "microsoft", userID: owner, accountID: "fixture", calendarID: calendar.id, externalCalendarID: "primary" });
        const request = { provider: "microsoft", action: "create", notificationPolicy: "server-invite", operationID: randomUUID(), eventID: randomUUID(), calendarID: calendar.id, color: "red", content: { title: "Private meeting", description: "Notes", location: "Room" }, time: { kind: "zoned", timeZone: "UTC", startLocal: "2026-09-15T09:00:00", endLocal: "2026-09-15T10:00:00" }, guests: [{ email: "guest@example.test", optional: false }] };
        if (scenario === "scope") { await assert.rejects(queueProviderOrganizer(owner, request)); assert.equal(posts, 0); continue; }
        await queueProviderOrganizer(owner, request);
        const row = async () => (await db.select().from(eventOutbox).where(eq(eventOutbox.id, request.operationID)))[0]!;
        const immutable = (await row()).payload.organizer!;
        assert.ok((await db.select().from(eventUsers).where(eq(eventUsers.eventID, request.eventID))).every(attendee => attendee.userID === owner), "Provider guests stay outside Musubi attendance");
        if (scenario === "identity-replay") { await assert.rejects(queueProviderOrganizer(owner, { ...request, guests: [{ email: "changed@example.test", optional: false }] })); assert.equal(posts, 0); }
        if (scenario === "swapped") mode = "swapped";
        if (scenario === "answered") mode = "answered";
        if (scenario === "lost") mode = "lost";
        if (scenario === "restart") {
          const claimed = await claimEventOutbox(request.operationID); assert.ok(claimed); await markProviderOrganizer(claimed!);
          await db.update(eventOutbox).set({ status: "unconfirmed", leaseToken: null, leaseUntil: null }).where(eq(eventOutbox.id, request.operationID));
          await requestEventDeliveryRetry(owner, request.eventID, request.operationID);
        }
        if (scenario === "pull-before-ack") {
          mode = "after-post";
          hook = async () => {
            const saved = await getEventSnapshot(request.eventID); assert.ok(saved);
            await upsertExternalEvent("microsoft", owner, calendar.id, "primary", "native", { title: saved!.title, color: saved!.color, start: saved!.start, end: saved!.end, isAllDay: saved!.isAllDay, description: saved!.description ?? null, location: saved!.location ?? null, organizer: "owner@example.test", recurrence: null, url: null }, 'W/"v1"', "uid", request.operationID);
            assert.equal((await db.select().from(externalEvents).where(eq(externalEvents.eventID, request.eventID))).length, 0, "Projected echo cannot ACK or duplicate organizer identity");
            assert.ok((await row()).remoteSnapshot);
          };
        }
        if (scenario === "role-before") { mode = "before-post"; hook = async () => { await db.update(calendarMembers).set({ role: "viewer" }).where(eq(calendarMembers.calendarID, calendar.id)); }; }
        if (scenario === "generation-before" || scenario === "generation-after") { mode = scenario === "generation-before" ? "before-post" : "after-post"; hook = async () => { await db.update(externalCalendars).set({ providerAccessRevision: 2 }).where(eq(externalCalendars.calendarID, calendar.id)); }; }
        await deliverEventOutbox(request.operationID, provider => provider === "microsoft" ? microsoftAdapter : null);
        const result = await row();
        console.log("Graph fixture outcome", scenario, result.status, result.errorCode, posts);
        assert.deepEqual({ ...result.payload.organizer, dispatch: undefined }, { ...immutable, dispatch: undefined });
        if (["role-before", "generation-before", "restart", "swapped"].includes(scenario)) { assert.equal(posts, 0); assert.notEqual(result.status, "completed"); }
        else if (scenario === "generation-after") { assert.equal(posts, 1); assert.notEqual(result.status, "completed"); assert.equal((await db.select().from(externalEvents).where(eq(externalEvents.eventID, request.eventID))).length, 0); }
        else {
          assert.deepEqual(await getOrganizerTimeEventIDs(owner, "fixture", "primary", "microsoft"), ["native"]);
          assert.equal(result.status, "completed"); assert.equal(posts, 1);
          assert.equal((await db.select().from(externalEvents).where(eq(externalEvents.eventID, request.eventID)))[0]!.externalEventID, "native");
          assert.equal((await getEventSnapshot(request.eventID))!.title, "Private meeting");
          await queueProviderOrganizer(owner, request); assert.equal(posts, 1);
        }
      } finally { await db.delete(user).where(eq(user.id, owner)); }
    }
    console.log("Graph organizer DB: private create journal, lost response, permanent marker, grant races, strict replay and stable ACK: OK");
  } finally { globalThis.fetch = oldFetch; config.api.providerOrganizerEditsEnabled = oldFlag; }
}
main().then(() => process.exit(0), error => { console.error(error); process.exit(1); });
