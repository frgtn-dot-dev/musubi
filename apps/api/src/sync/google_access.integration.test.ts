import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { eq } from "drizzle-orm";
import { account, db, events, externalCalendars, externalEvents, getOwnProviderEventState, getUserExternalCalendars, getUsersEvents, reconcileGoogleCalendarAccess, setCursor, user } from "@musubi/db";
import { googleAdapter } from "./adapters/google";
import { syncProvider } from "./engine";

async function main() {
  assert.equal(process.env.ENVIRONMENT, "test");
  const userID = `google-access-${randomUUID()}`;
  const accountID = "fixture-account";
  let role: "owner" | "reader" | "writerWithoutPrivateAccess" = "owner";
  let mode: "event" | "delete" | "empty" = "event";
  let sequence = 0;
  let hold: { entered: () => void; wait: Promise<void> } | undefined;
  const observedCursors: (string | null)[] = [];
  const fixture = createServer(async (req, res) => {
    const url = new URL(req.url!, "http://fixture.test");
    assert.equal(req.method, "GET");
    assert.equal(req.headers.authorization, "Bearer fixture-access");
    res.setHeader("content-type", "application/json");
    const json = (body: unknown) => res.end(JSON.stringify(body));
    if (url.pathname === "/calendar/v3/users/me/calendarList") return json({ items: [{ id: "calendar", summary: "Fixture", backgroundColor: "#7A8BA3", accessRole: role }] });
    if (url.pathname === "/tasks/v1/users/@me/lists") return json({ items: [] });
    if (url.pathname === "/calendar/v3/calendars/calendar/events") {
      observedCursors.push(url.searchParams.get("syncToken"));
      const current = ++sequence;
      const items = mode === "empty" ? [] : mode === "delete" ? [{ id: "native-event", status: "cancelled" }] : [{
        id: "native-event", etag: `"v${current}"`, status: "confirmed", iCalUID: "fixture-uid", visibility: "private",
        summary: role === "owner" ? `Private ${current}` : "Busy",
        description: role === "owner" ? "Private notes" : undefined,
        organizer: role === "owner" ? { email: "private-host@example.test", self: false } : undefined,
        start: { dateTime: "2026-09-15T09:00:00Z", timeZone: "UTC" }, end: { dateTime: "2026-09-15T10:00:00Z", timeZone: "UTC" },
      }];
      const pending = hold; hold = undefined;
      if (pending) { pending.entered(); await pending.wait; }
      return json({ items, nextSyncToken: `cursor-${current}` });
    }
    res.statusCode = 500; return json({ error: { message: "Unexpected fixture request" } });
  });
  await new Promise<void>(resolve => fixture.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(fixture.address() as { port: number }).port}`;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const url = new URL(String(input));
    assert.ok(["www.googleapis.com", "tasks.googleapis.com"].includes(url.hostname), "Never call real accounts");
    return realFetch(`${origin}${url.pathname}${url.search}`, init);
  };
  await db.insert(user).values({ id: userID, name: "Access", email: `${userID}@example.test` });
  const sync = () => syncProvider(googleAdapter, userID, { id: accountID, label: "Fixture" });
  const link = async () => (await getUserExternalCalendars("google", userID, accountID))[0]!;
  const snapshot = async () => ({ events: await db.select().from(events).where(eq(events.creatorID, userID)), mappings: await db.select().from(externalEvents).where(eq(externalEvents.calendarID, (await link()).calendarID)), source: await db.select().from(externalCalendars).where(eq(externalCalendars.userID, userID)) });
  try {
    await db.insert(account).values({ id: randomUUID(), userId: userID, providerId: "google", accountId: accountID, scope: "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/tasks", accessToken: "fixture-access", refreshToken: "fixture-refresh", accessTokenExpiresAt: new Date(Date.now() + 3600_000) });
    await sync();
    const initial = await link();
    assert.equal(initial.providerAccessRevision, 1);
    const id = (await getUsersEvents(userID))[0]!.event.id;
    assert.equal((await getOwnProviderEventState(userID, id))?.organizer?.address, "private-host@example.test");
    assert.equal(await reconcileGoogleCalendarAccess(userID, accountID, initial.calendarID, "owner"), false);
    assert.deepEqual(await link(), initial, "Unchanged access retains cursor and generation");

    // Hold a fully captured old native response while a newer discovery and
    // fresh full fetch commit. Cover upsert, explicit deletion and empty sweep.
    for (const staleMode of ["event", "delete", "empty"] as const) {
      role = "owner"; mode = "event"; await sync();
      if (staleMode === "empty") await setCursor(initial.calendarID, null);
      mode = staleMode;
      let entered!: () => void, release!: () => void;
      const reached = new Promise<void>(resolve => { entered = resolve; });
      hold = { entered, wait: new Promise<void>(resolve => { release = resolve; }) };
      const old = sync().then(() => ({ error: null as unknown }), error => ({ error }));
      try {
        await reached;
        const before = await link();
        role = "reader"; mode = "event"; await sync();
        assert.equal(observedCursors[observedCursors.length - 1], null, "Changed grant forces fresh full fetch");
        assert.equal((await link()).providerAccessRevision, before.providerAccessRevision + 1);
        assert.equal((await getUsersEvents(userID))[0]!.event.id, id, "Permission refresh preserves canonical identity");
        assert.equal((await getUsersEvents(userID))[0]!.event.title, "Busy");
        assert.equal((await getOwnProviderEventState(userID, id))?.organizer, null);
        const accepted = await snapshot();
        release();
        assert.match(String((await old).error), staleMode === "event" ? /External event observation could not be persisted/ : staleMode === "delete" ? /External event deletion could not be persisted/ : /Calendar access changed during sync/);
        assert.deepEqual(await snapshot(), accepted, "Old response cannot change content, mappings, tombstones or cursor");
      } finally { release(); await old; }
    }

    // Same role again is not the same authority generation (ABA).
    role = "owner"; mode = "event"; await sync(); mode = "empty";
    let entered!: () => void, release!: () => void;
    const reached = new Promise<void>(resolve => { entered = resolve; });
    hold = { entered, wait: new Promise<void>(resolve => { release = resolve; }) };
    const old = sync().then(() => ({ error: null as unknown }), error => ({ error }));
    try {
      await reached;
      const before = await link();
      await reconcileGoogleCalendarAccess(userID, accountID, initial.calendarID, "writerWithoutPrivateAccess");
      await reconcileGoogleCalendarAccess(userID, accountID, initial.calendarID, "owner");
      assert.equal((await link()).providerAccessRevision, before.providerAccessRevision + 2);
      const accepted = await snapshot();
      release();
      assert.match(String((await old).error), /Calendar access changed during sync/, "Empty delta must not advance cursor after ABA");
      assert.deepEqual(await snapshot(), accepted);
    } finally { release(); await old; }
    console.log("Google discovery access generations: stable no-op, fresh full fetch, retained IDs and stale upsert/delete/sweep/cursor/ABA refusal: OK");
  } finally {
    globalThis.fetch = realFetch;
    await db.delete(user).where(eq(user.id, userID));
    await new Promise<void>(resolve => fixture.close(() => resolve()));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
