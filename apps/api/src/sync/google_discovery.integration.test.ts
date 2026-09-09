import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { eq } from "drizzle-orm";
import {
  account, db, events, externalEvents, getUserExternalCalendars,
  importExternalCalendar, setCursor, upsertExternalEvent, user, getUsersEvents, getOwnProviderEventState,
} from "@musubi/db";
import { googleEventState } from "./adapters/provider_event_state";
import { googleAdapter } from "./adapters/google";
import { syncProvider } from "./engine";

async function main() {
  assert.equal(process.env.ENVIRONMENT, "test");
  const userID = `google-discovery-${randomUUID()}`;
  let failPageTwo = true;
  let lastAccess = "reader";
  let failEvents = false;
  const pages: (string | null)[] = [];
  const fixture = createServer((req, res) => {
    const url = new URL(req.url!, "http://fixture.test");
    assert.equal(req.method, "GET");
    assert.equal(req.headers.authorization, "Bearer fixture-access");
    res.setHeader("content-type", "application/json");
    const json = (body: unknown) => res.end(JSON.stringify(body));
    if (url.pathname === "/calendar/v3/users/me/calendarList") {
      const token = url.searchParams.get("pageToken");
      pages.push(token);
      if (token === "page two/+?" && failPageTwo) {
        res.statusCode = 503;
        return json({ error: { message: "Page two unavailable" } });
      }
      const calendar = (id: string, accessRole: string) => ({ id, summary: id, backgroundColor: "#7A8BA3", accessRole });
      if (!token) return json({ items: [calendar("first", "owner")], nextPageToken: "page two/+?" });
      if (token === "page two/+?") return json({ items: [], nextPageToken: "page-three" });
      if (token === "page-three") return json({ items: [calendar("last", lastAccess)] });
    }
    if (url.pathname === "/tasks/v1/users/@me/lists") return json({ items: [] });
    if (url.pathname.endsWith("/events")) {
      if (failEvents) { res.statusCode = 503; return json({ error: { message: "Events unavailable" } }); }
      return json({ items: [], nextSyncToken: "fresh-cursor" });
    }
    res.statusCode = 500;
    return json({ error: { message: `Unexpected ${url}` } });
  });
  await new Promise<void>((resolve) => fixture.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(fixture.address() as { port: number }).port}`;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const url = new URL(String(input));
    assert.ok(["www.googleapis.com", "tasks.googleapis.com"].includes(url.hostname), "Never call real providers");
    return realFetch(`${origin}${url.pathname}${url.search}`, init);
  };
  await db.insert(user).values({ id: userID, name: "Discovery", email: `${userID}@example.test` });
  try {
    await db.insert(account).values({
      id: randomUUID(), userId: userID, providerId: "google", accountId: "account",
      scope: "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/tasks",
      refreshToken: "fixture-refresh", accessToken: "fixture-access", accessTokenExpiresAt: new Date(Date.now() + 3600_000),
    });
    const links: string[] = [];
    for (const externalId of ["first", "last", "actually-removed"]) {
      const { id: calendarID } = await importExternalCalendar("google", userID, "account", "Fixture", { externalId, name: externalId, color: "#7A8BA3" });
      links.push(calendarID);
      await setCursor(calendarID, "old-cursor");
      await upsertExternalEvent("google", userID, calendarID, externalId, `event-${externalId}`, {
        title: "Retain me", color: "#7A8BA3", start: new Date("2026-07-01T09:00:00Z"), end: new Date("2026-07-01T10:00:00Z"),
        isAllDay: false, description: "Private agenda", location: null, organizer: "", recurrence: null, url: null,
      }, null, null, undefined, undefined, undefined, googleEventState({ visibility: "private", organizer: { email: "private-host@example.test", self: false }, attendees: [{ email: "private-guest@example.test", self: true, responseStatus: "accepted" }], hangoutLink: "https://meet.example.test/private" }));
    }
    const before = await getUserExternalCalendars("google", userID, "account");
    const eventsBefore = await db.select().from(events).where(eq(events.creatorID, userID));
    const mappingsBefore = await db.select().from(externalEvents).where(eq(externalEvents.calendarID, links[1]));
    await assert.rejects(syncProvider(googleAdapter, userID, { id: "account", label: "Fixture" }), /Google 503/);
    assert.deepEqual(pages, [null, "page two/+?"]);
    assert.deepEqual(await getUserExternalCalendars("google", userID, "account"), before, "Incomplete discovery must not sweep mirrors or advance cursors");
    assert.deepEqual(await db.select().from(events).where(eq(events.creatorID, userID)), eventsBefore);
    assert.deepEqual(await db.select().from(externalEvents).where(eq(externalEvents.calendarID, links[1])), mappingsBefore);

    failPageTwo = false;
    pages.length = 0;
    const discovered = await googleAdapter.listCalendars(userID, "account");
    assert.deepEqual(discovered.calendars.map((calendar) => [calendar.externalId, calendar.readOnly]), [["first", false], ["last", true]]);
    assert.deepEqual(pages, [null, "page two/+?", "page-three"], "Follow tokens even through an empty page");
    pages.length = 0;
    await syncProvider(googleAdapter, userID, { id: "account", label: "Fixture" });
    const after = await getUserExternalCalendars("google", userID, "account");
    assert.deepEqual(new Set(after.map((link) => link.calendarID)), new Set(links.slice(0, 2)), "Complete discovery preserves late-page mirrors and sweeps only truly absent ones");
    assert.ok(after.every((link) => link.cursor === "fresh-cursor"));
    assert.equal(await getOwnProviderEventState(userID, mappingsBefore[0].eventID), null, "Initial access evidence invalidates old cursor; the fresh empty full set cannot retain private observations");
    lastAccess = "freeBusyReader";
    failEvents = true;
    await assert.rejects(syncProvider(googleAdapter, userID, { id: "account", label: "Fixture" }), /Google 503/);
    assert.equal((await getUserExternalCalendars("google", userID, "account")).some(link => link.externalCalendarID === "last"), false, "Downgraded detail mirror must disappear before a failing event fetch");
    assert.equal((await getUsersEvents(userID)).some(row => row.calendarID === links[1]), false);
    assert.equal(await getOwnProviderEventState(userID, mappingsBefore[0].eventID), null);
    assert.equal((await db.select().from(externalEvents).where(eq(externalEvents.calendarID, links[1]))).length, 0);
    failEvents = false;
    lastAccess = "reader";
    await syncProvider(googleAdapter, userID, { id: "account", label: "Fixture" });
    assert.ok((await getUserExternalCalendars("google", userID, "account")).some(link => link.externalCalendarID === "last"), "Restored detail access can import again without opt-out tombstone");
    console.log("K02 Google discovery: actual paginated HTTP, page-two failure preserves DB, complete retry and authoritative sweep OK");
  } finally {
    globalThis.fetch = realFetch;
    await db.delete(user).where(eq(user.id, userID));
    await new Promise<void>((resolve) => fixture.close(() => resolve()));
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
