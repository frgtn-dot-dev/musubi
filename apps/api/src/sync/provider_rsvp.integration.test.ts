import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { eq, and } from "drizzle-orm";
import { config } from "@musubi/config";
import { db, user, account, events, eventOutbox, externalCalendars, externalEvents, calendarMembers, createCalendar, upsertExternalEvent, getEventSnapshot, getOwnProviderEventObservation } from "@musubi/db";
import { queueGoogleRsvp } from "./provider_rsvp";
import { googleEventState } from "./adapters/provider_event_state";
import { googleAdapter } from "./adapters/google";
import { deliverEventOutbox } from "./event_delivery";

async function main() {
  assert.equal(process.env.ENVIRONMENT, "test");
  const oldFlag = config.api.providerRsvpEditsEnabled;
  let remote: any, beforeRead: (() => Promise<void>) | undefined;
  let http = 0, reads = 0, patches = 0;
  const server = createServer(async (req, res) => {
    http++;
    assert.equal(req.headers.authorization, "Bearer synthetic-rsvp-access");
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/calendar/v3/users/me/calendarList/primary") { res.end(JSON.stringify({ id: "guest@example.test", primary: true, accessRole: "owner" })); return; }
    assert.equal(req.url, "/calendar/v3/calendars/guest%40example.test/events/meeting");
    if (req.method !== "GET") patches++;
    assert.equal(req.method, "GET"); reads++;
    if (beforeRead) { const action = beforeRead; beforeRead = undefined; await action(); }
    res.end(JSON.stringify(remote));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const realFetch = globalThis.fetch;
  globalThis.fetch = (input, init) => { const url = new URL(String(input)); assert.equal(url.origin, "https://www.googleapis.com", "No live requests allowed"); return realFetch(`http://127.0.0.1:${address.port}${url.pathname}${url.search}`, init); };
  try {
    for (const scenario of ["queue", "concurrent", "disabled", "wrong-user", "wrong-scope", "viewer", "revision-race", "role-race", "mapping-race", "native-state-race", "native-time-race", "known-zoned", "known-all-day"]) {
      console.log(`RSVP DB scenario: ${scenario}`);
      const owner = `rsvp-${randomUUID()}`;
      remote = { id: "meeting", etag: '\"v1\"', status: "confirmed", summary: "Private meeting", start: { dateTime: "2026-09-10T11:00:00+02:00", timeZone: "Europe/Prague" }, end: { dateTime: "2026-09-10T12:00:00+02:00", timeZone: "Europe/Prague" }, organizer: { email: "host@example.test", self: false }, attendees: [{ email: "guest@example.test", self: true, responseStatus: "needsAction", comment: "Private attendee comment" }, { email: "other@example.test", responseStatus: "accepted" }], reminders: { useDefault: true }, conferenceData: { entryPoints: [{ uri: "https://meet.example.test/private" }] }, extendedProperties: { private: { secret: "Private baseline" } } };
      if (scenario === "known-all-day") { remote.start = { date: "2026-09-10" }; remote.end = { date: "2026-09-11" }; }
      await db.insert(user).values({ id: owner, name: owner, email: `${owner}@example.test`, isExternal: true });
      try {
        const accountID = randomUUID();
        await db.insert(account).values({ id: accountID, userId: owner, providerId: "google", accountId: "fixture", scope: scenario === "wrong-scope" ? "openid email" : "https://www.googleapis.com/auth/calendar.events", accessToken: "synthetic-rsvp-access", refreshToken: "synthetic-rsvp-refresh", accessTokenExpiresAt: new Date(Date.now() + 3600000) });
        const calendar = await createCalendar({ creatorID: owner, name: "RSVP fixture", color: "red" });
        const [link] = await db.insert(externalCalendars).values({ provider: "google", userID: owner, accountID: "fixture", calendarID: calendar.id, externalCalendarID: "guest@example.test" }).returning();
        await upsertExternalEvent("google", owner, calendar.id, "guest@example.test", remote.id, { title: remote.summary, color: "red", start: new Date(remote.start.dateTime ?? "2026-09-10T00:00:00Z"), end: new Date(remote.end.dateTime ?? "2026-09-10T00:00:00Z"), isAllDay: !!remote.start.date, description: null, location: null, organizer: remote.organizer.email, recurrence: null, url: null }, remote.etag, null, undefined, undefined, undefined, googleEventState(remote));
        const [mapping] = await db.select().from(externalEvents).where(eq(externalEvents.calendarID, calendar.id));
        if (scenario.startsWith("known-")) await db.update(events).set({ timeModel: scenario === "known-all-day" ? { kind: "all-day" } : { kind: "zoned", timeZone: "Europe/Prague", startLocal: "2026-09-10T11:00:00.000", endLocal: "2026-09-10T12:00:00.000" } }).where(eq(events.id, mapping!.eventID));
        const original = (await getEventSnapshot(mapping!.eventID))!;
        const observation = await getOwnProviderEventObservation(owner, original.id);
        const request = { provider: "google", operationID: randomUUID(), expectedRevision: original.revision, expectedStateVersion: observation.version, response: "accepted", sendUpdates: "all" };
        config.api.providerRsvpEditsEnabled = scenario !== "disabled";
        const member = and(eq(calendarMembers.calendarID, calendar.id), eq(calendarMembers.userID, owner));
        if (scenario === "viewer") await db.update(calendarMembers).set({ role: "viewer" }).where(member);
        if (scenario === "revision-race") beforeRead = async () => { await db.update(events).set({ revision: original.revision + 1 }).where(eq(events.id, original.id)); };
        if (scenario === "role-race") beforeRead = async () => { await db.update(calendarMembers).set({ role: "viewer" }).where(member); };
        if (scenario === "mapping-race") beforeRead = async () => { await db.update(externalEvents).set({ etag: '\"new\"' }).where(eq(externalEvents.id, mapping!.id)); };
        if (scenario === "native-state-race") beforeRead = async () => { remote.attendees[1].responseStatus = "declined"; };
        if (scenario === "native-time-race") beforeRead = async () => { remote.end.dateTime = "2026-09-10T13:00:00+02:00"; };
        const previousHttp = http;
        const send = () => queueGoogleRsvp(scenario === "wrong-user" ? "outsider" : owner, original.id, request);
        if (!["queue", "concurrent", "known-zoned", "known-all-day"].includes(scenario)) {
          await assert.rejects(send);
          assert.equal((await db.select().from(eventOutbox).where(eq(eventOutbox.eventID, original.id))).length, 0);
          if (["disabled", "wrong-user", "wrong-scope", "viewer"].includes(scenario)) assert.equal(http, previousHttp);
        } else {
          const receipts = scenario === "concurrent" ? await Promise.all([send(), send()]) : [await send()];
          assert.equal(new Set(receipts.map(item => item.operationID)).size, 1);
          const [row] = await db.select().from(eventOutbox).where(eq(eventOutbox.eventID, original.id));
          assert.ok(row!.payload.rsvp); assert.deepEqual(row!.payload.rsvp!.baseline, remote);
          assert.equal(row!.payload.rsvp!.desiredState.ownResponse, "accepted");
          assert.equal(row!.payload.rsvp!.baselineState.ownResponse, "needsAction");
          assert.equal(row!.externalCalendarLinkID, link!.id);
          assert.deepEqual(await getEventSnapshot(original.id), original);
          assert.deepEqual(await getOwnProviderEventObservation(owner, original.id), observation);
          const previousReads = reads;
          assert.equal((await send()).replayed, true); assert.equal(reads, previousReads);
          await assert.rejects(() => queueGoogleRsvp(owner, original.id, { ...request, response: "declined" }));
          const result = await deliverEventOutbox(row!.id, () => googleAdapter);
          assert.equal(result!.status, "blocked", "RSVP must not fall through the generic writer while its worker is unimplemented");
          assert.equal(patches, 0);
        }
      } finally { beforeRead = undefined; await db.delete(user).where(eq(user.id, owner)); }
    }
    console.log("RSVP prepare/commit HTTP+DB: private intent, replay, OAuth/source/CAS races, unchanged event and blocked generic worker: OK");
  } finally { config.api.providerRsvpEditsEnabled = oldFlag; globalThis.fetch = realFetch; await new Promise<void>(resolve => server.close(() => resolve())); await db.$client.end(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
