import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import express from "express";
import { eq, inArray } from "drizzle-orm";
import {
  account, CALENDAR_SCOPE, calendarEvents, calendarMembers, calendars, createCalendar,
  createEvent, db, events, externalEvents,
  getExternalEvent, importExternalCalendar, importExternalEvent,
  memberTokens, saveCaldavAccount, setExternalEventSyncData, user,
} from "@musubi/db";
import { EventSchema } from "@musubi/types";
import { withSeriesEditIntent } from "@musubi/calendar";
import { issueMemberToken } from "../federation_tokens";
import { requireAuth } from "../middleware/require_auth";
import { middlewareErrorHandler } from "../middleware/error_handler";
import { handlerCreateEvent, handlerUpdateEvent, handlerRemoveEvent, handlerLinkEvent, handlerForkEvent } from "./events";
import { handlerImportCalendar } from "./calendars";
import { encryptSecret } from "../sync/crypto";
import { caldavAdapter, icalToNormalized } from "../sync/adapters/caldav";

// Actual authenticated HTTP handlers, real adapters/HTTP and disposable Postgres.
// No live destination is reachable: even unexpected OAuth URLs fail closed.
async function main() {
  assert.equal(process.env.ENVIRONMENT, "test");
  assert.ok(process.env.DATABASE_URL);
  const owner = `k04-${randomUUID()}`;
  const viewer = `k04-viewer-${randomUUID()}`;
  const token = issueMemberToken();
  const viewerToken = issueMemberToken();
  const writes: { path: string; method: string; auth?: string; body: string }[] = [];
  const reads: { path: string; auth?: string }[] = [];
  let role: string | undefined = "owner";
  let canEdit: boolean | undefined = true;
  let organizer: boolean | undefined = true;
  let googleGuestDefault = false;
  let privileges: string[] | undefined = ["write"];
  let addresses: string[] | undefined = ["mailto:owner@example.test"];
  const importedPrivileges: string[] | undefined = ["bind"];
  let remoteCalendarCreates = 0;
  let davData = ["BEGIN:VCALENDAR", "VERSION:2.0", "BEGIN:VEVENT", "UID:fixture", "DTSTART:20260101T100000Z", "DTEND:20260101T110000Z", "SUMMARY:Before", "END:VEVENT", "END:VCALENDAR"].join("\r\n");
  const xmlEscape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const fixture = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      const url = new URL(req.url!, "http://fixture.test");
      const path = url.pathname;
      const method = req.method!;
      const json = (value: unknown, status = 200) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(value)); };
      const xml = (href: string, props: string, status = "200 OK") => {
        res.writeHead(207, { "content-type": "application/xml" });
        res.end(`<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:response><d:href>${href}</d:href><d:propstat><d:prop>${props}</d:prop><d:status>HTTP/1.1 ${status}</d:status></d:propstat></d:response></d:multistatus>`);
      };
      if (["POST", "PUT", "PATCH", "DELETE", "MKCALENDAR"].includes(method)) {
        if (path === "/v1.0/me/calendars" || method === "MKCALENDAR") {
          remoteCalendarCreates++;
          return json({ id: `imported-${remoteCalendarCreates}` }, 201);
        }
        writes.push({ path, method, auth: req.headers.authorization, body });
        if (method === "PUT" && path.startsWith("/dav/")) davData = body;
        if (method === "DELETE") { res.writeHead(204); return res.end(); }
        if (path.startsWith("/dav/")) { res.writeHead(201, { etag: '"next"' }); return res.end(); }
        return json({ id: "created" }, 201);
      }
      reads.push({ path, auth: req.headers.authorization });
      if (path === "/v1.0/me") return json({ mail: "owner@example.test" });
      if (path.includes("/calendarList/")) return json({ accessRole: path.endsWith("/denied") ? "reader" : role });
      if (path.startsWith("/v1.0/me/calendars/") && !path.includes("/events/")) return json({ canEdit });
      if (path.includes("/events/")) return json(path.startsWith("/v1.0") ? { isOrganizer: organizer } : { organizer: googleGuestDefault ? { email: "host@example.test", displayName: "Host" } : { self: organizer } });
      if (method === "REPORT") return xml("/dav/cal/event.ics", `<d:getetag>"current"</d:getetag><c:calendar-data>${xmlEscape(davData)}</c:calendar-data>`);
      if (method === "PROPFIND") {
        if (body.includes("current-user-privilege-set")) {
          const grants = path.includes("musubi-") ? importedPrivileges : privileges;
          return grants ? xml(path, `<d:current-user-privilege-set>${grants.map((name) => `<d:privilege><d:${name}/></d:privilege>`).join("")}</d:current-user-privilege-set>`) : xml(path, "<d:current-user-privilege-set/>", "404 Not Found");
        }
        if (body.includes("calendar-user-address-set")) return addresses ? xml(path, `<c:calendar-user-address-set>${addresses.map((address) => `<d:href>${address}</d:href>`).join("")}</c:calendar-user-address-set>`) : xml(path, "", "404 Not Found");
        if (body.includes("supported-calendar-component-set")) return xml("/dav/cal/", '<d:resourcetype><d:collection/><c:calendar/></d:resourcetype><d:displayname>DAV fixture</d:displayname><c:supported-calendar-component-set><c:comp name="VEVENT"/></c:supported-calendar-component-set>');
        return xml(path, '<d:current-user-principal><d:href>/dav/principal/</d:href></d:current-user-principal><c:calendar-home-set><d:href>/dav/</d:href></c:calendar-home-set>');
      }
      if (path === "/.well-known/caldav") { res.writeHead(404); return res.end(); }
      return json({ error: `Unexpected fixture request ${method} ${path}` }, 500);
    });
  });
  await new Promise<void>((resolve) => fixture.listen(0, "127.0.0.1", resolve));
  const fixtureOrigin = `http://127.0.0.1:${(fixture.address() as { port: number }).port}`;
  const app = express();
  app.use(express.json());
  app.post("/events", requireAuth, handlerCreateEvent);
  app.put("/events", requireAuth, handlerUpdateEvent);
  app.delete("/events", requireAuth, handlerRemoveEvent);
  app.post("/events/:eventId/link", requireAuth, handlerLinkEvent);
  app.post("/events/:eventId/fork", requireAuth, handlerForkEvent);
  app.post("/import", express.text({ type: "text/calendar" }), requireAuth, handlerImportCalendar);
  app.use(middlewareErrorHandler);
  const api = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => api.once("listening", resolve));
  const apiOrigin = `http://127.0.0.1:${(api.address() as { port: number }).port}`;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const url = new URL(String(input));
    if ([fixtureOrigin, apiOrigin].includes(url.origin)) return realFetch(input, init);
    assert.ok(["www.googleapis.com", "graph.microsoft.com"].includes(url.hostname), `No live requests: ${url}`);
    return realFetch(`${fixtureOrigin}${url.pathname}${url.search}`, init);
  };
  const request = (method: string, body: unknown, path = "/events", bearer = token.raw) => fetch(`${apiOrigin}${path}`, {
    method, headers: { "content-type": "application/json", authorization: `Bearer ${bearer}` }, body: JSON.stringify(body),
  });
  const snapshot = async () => JSON.stringify([
    await db.select().from(events).orderBy(events.id),
    await db.select().from(calendarEvents).orderBy(calendarEvents.eventID, calendarEvents.calendarID),
    await db.select().from(externalEvents).orderBy(externalEvents.id),
  ]);
  const refuses = async (run: () => Promise<Response>, reason: string, status = 403) => {
    const before = await snapshot();
    writes.length = 0;
    const response = await run();
    const body = await response.json();
    assert.equal(response.status, status, JSON.stringify(body));
    if (status === 403) assert.equal(body.reason, reason, JSON.stringify(body));
    assert.equal(writes.length, 0, "No first provider write, even with a later denied target");
    assert.equal(await snapshot(), before, "No event/link/mapping mutation on refusal");
    return body;
  };
  const eventIn = (calendarIDs: string[], recurrence: string | null = null) => EventSchema.parse({
    id: randomUUID(), creatorID: owner, organizer: owner, title: "Before", color: "#7A8BA3",
    start: "2026-01-01T10:00:00Z", end: "2026-01-01T11:00:00Z", isAllDay: false,
    isCanceled: false, calendars: calendarIDs, originCalendarID: calendarIDs[0], recurrence,
  });
  await db.insert(user).values([owner, viewer].map((id) => ({ id, name: id, email: `${id}@example.test`, isExternal: true })));
  try {
    await db.insert(memberTokens).values([{ userID: owner, tokenHash: token.tokenHash }, { userID: viewer, tokenHash: viewerToken.tokenHash }]);
    await db.insert(account).values(["google", "microsoft"].flatMap((providerId) => ["primary", "sibling"].map((accountId) => ({
      id: randomUUID(), userId: owner, providerId, accountId, scope: CALENDAR_SCOPE[providerId],
      accessToken: `${accountId}-access`, refreshToken: "fixture-refresh", accessTokenExpiresAt: new Date(Date.now() + 3600_000),
    }))));
    const local = await createCalendar({ creatorID: owner, name: "Local", color: "#7A8BA3" });
    const mirror = (provider: string, externalId: string, accountID = "primary", role = "owner") => importExternalCalendar(provider, owner, accountID, "Fixture", { externalId, name: externalId, color: "#7A8BA3" }, role);
    const google = await mirror("google", "allowed");
    const denied = await mirror("google", "denied");
    const outlook = await mirror("microsoft", "outlook");
    const sibling = await mirror("google", "allowed", "sibling");
    const taskOnly = await importExternalCalendar("google", owner, "primary", "Tasks", { externalId: "tasks-only", name: "Tasks", color: "#7A8BA3", supportsEvents: false, supportsTasks: true });
    await refuses(() => request("POST", eventIn([google.id, taskOnly.id])), "unsupported");
    await refuses(() => request("POST", eventIn([google.id, denied.id])), "denied");
    role = undefined;
    await refuses(() => request("POST", eventIn([google.id])), "unknown");
    role = "owner";
    await refuses(() => request("POST", eventIn([local.id, outlook.id], "RRULE:FREQ=WEEKLY")), "unsupported");
    const event = eventIn([google.id]);
    assert.equal((await request("POST", event)).status, 201);
    assert.equal(writes[writes.length - 1]?.method, "POST");
    role = "reader"; // Permission changed AFTER the form's calendar role was loaded.
    await refuses(() => request("PUT", { ...event, title: "Changed" }), "denied");
    role = "owner";
    for (organizer of [false, undefined]) await refuses(() => request("PUT", { ...event, title: "Changed", organizer: owner }), organizer === false ? "denied" : "unknown");
    await refuses(() => request("DELETE", event), "unknown");
    googleGuestDefault = true;
    await refuses(() => request("PUT", { ...event, title: "Guest cannot edit host" }), "denied");
    const guestCopy = eventIn([google.id]);
    assert.equal((await request("POST", guestCopy)).status, 201);
    assert.equal((await request("DELETE", guestCopy)).status, 200, "Documented Google self=false default allows personal copy removal");
    googleGuestDefault = false;
    organizer = true;
    assert.equal((await request("PUT", { ...event, title: "Allowed" })).status, 200);
    const mixed = eventIn([google.id, denied.id]);
    await createEvent(mixed, mixed.calendars);
    await importExternalEvent("google", mixed.id, google.id, "allowed", "mixed");
    await importExternalEvent("google", mixed.id, denied.id, "denied", "mixed");
    await refuses(() => request("PUT", { ...mixed, calendars: [denied.id], title: "Must not delete first" }), "denied");
    await refuses(() => request("DELETE", mixed), "denied");
    for (const action of ["link", "fork"]) await refuses(() => request("POST", { calendarID: denied.id }, `/events/${event.id}/${action}`), "denied");
    await refuses(() => request("DELETE", { ...mixed, unlinkCalendarID: denied.id }), "denied");
    const source = eventIn([local.id], "RRULE:FREQ=WEEKLY");
    await createEvent(source, source.calendars);
    for (const action of ["link", "fork"]) await refuses(() => request("POST", { calendarID: outlook.id }, `/events/${source.id}/${action}`), "unsupported");
    const intent = withSeriesEditIntent({ updates: [{ ...source, title: "First must not save" }], creates: [eventIn([outlook.id], source.recurrence)] });
    await refuses(() => request("PUT", intent.updates[0]), "unsupported");
    const deniedIntent = withSeriesEditIntent({ updates: [{ ...source, title: "Must stay unchanged" }], creates: [eventIn([google.id, denied.id])] });
    await refuses(() => request("PUT", deniedIntent.updates[0]), "denied");
    await refuses(() => request("PUT", { ...intent.updates[0], title: "Mismatch" }), "", 400);
    await refuses(() => request("PUT", { ...source, scopeEdit: { updates: [], creates: [] } }), "", 400);
    const recurringOutlook = eventIn([outlook.id], "RRULE:FREQ=WEEKLY");
    await createEvent(recurringOutlook, recurringOutlook.calendars);
    await importExternalEvent("microsoft", recurringOutlook.id, outlook.id, "outlook", "master");
    await refuses(() => request("PUT", { ...recurringOutlook, recurrence: "RRULE:FREQ=DAILY" }), "unsupported");
    assert.equal((await request("PUT", { ...recurringOutlook, title: "Safe content" })).status, 200);
    assert.equal(JSON.parse(writes[writes.length - 1]!.body).recurrence, undefined);
    canEdit = undefined;
    await refuses(() => request("POST", eventIn([outlook.id])), "unknown");
    canEdit = false;
    await refuses(() => request("POST", eventIn([outlook.id])), "denied");
    canEdit = true;
    // Same remote identity in two local mirrors: mapping reads/updates and writes stay isolated.
    await importExternalEvent("google", event.id, sibling.id, "allowed", "sibling-event", '"sibling"');
    assert.equal((await getExternalEvent("google", event.id, "allowed", sibling.id))?.externalEventId, "sibling-event");
    await setExternalEventSyncData("google", event.id, "allowed", { etag: '"home"', icalUid: null }, google.id);
    assert.equal((await getExternalEvent("google", event.id, "allowed", sibling.id))?.etag, '"sibling"');
    writes.length = 0;
    assert.equal((await request("PUT", { ...event, title: "Scoped identity" })).status, 200);
    assert.deepEqual(writes.map((write) => [write.auth, write.path]), [["Bearer primary-access", "/calendar/v3/calendars/allowed/events/created"]]);
    const davAccount = await saveCaldavAccount(owner, `${fixtureOrigin}/dav/`, "owner", encryptSecret("fixture-password"));
    const dav = await mirror("caldav", `${fixtureOrigin}/dav/cal/`, davAccount.id, "viewer");
    const davEvent = eventIn([dav.id]);
    privileges = undefined;
    await refuses(() => request("POST", davEvent), "unknown");
    privileges = ["read"];
    await refuses(() => request("POST", davEvent), "denied");
    privileges = ["bind"];
    assert.equal((await request("POST", davEvent)).status, 201, "Projected viewer with fresh bind can create");
    await db.update(externalEvents).set({ externalEventID: `${fixtureOrigin}/dav/cal/event.ics`, etag: '"current"', icalUid: davEvent.id }).where(eq(externalEvents.eventID, davEvent.id));
    await refuses(() => request("PUT", { ...davEvent, title: "No content right" }), "denied");
    await refuses(() => request("DELETE", davEvent), "denied");
    privileges = ["write-content"];
    assert.equal((await request("PUT", { ...davEvent, title: "Content right" })).status, 200);
    await refuses(() => request("POST", eventIn([dav.id])), "denied");
    privileges = ["unbind"];
    assert.equal((await request("DELETE", davEvent)).status, 200);
    // Calendar owner is NOT organizer identity. No ORGANIZER remains a plain appointment.
    privileges = ["write"];
    davData = ["BEGIN:VCALENDAR", "VERSION:2.0", "BEGIN:VEVENT", "UID:series", "DTSTART:20260101T100000Z", "DTEND:20260101T110000Z", "RRULE:FREQ=WEEKLY", "ORGANIZER:mailto:owner@example.test", "SUMMARY:Series", "END:VEVENT", "BEGIN:VEVENT", "UID:series", "RECURRENCE-ID:20260108T100000Z", "DTSTART:20260108T120000Z", "DTEND:20260108T130000Z", "SUMMARY:Detached", "END:VEVENT", "END:VCALENDAR"].join("\r\n");
    const normalized = icalToNormalized({ url: "unused", data: davData })!;
    const series = { ...eventIn([dav.id]), recurrence: normalized.recurrence };
    await createEvent(series, series.calendars);
    await importExternalEvent("caldav", series.id, dav.id, `${fixtureOrigin}/dav/cal/`, `${fixtureOrigin}/dav/cal/event.ics`, '"current"', "series");
    const originalResource = davData;
    await refuses(() => request("PUT", { ...series, recurrence: "RRULE:FREQ=DAILY" }), "unsupported");
    assert.equal(davData, originalResource);
    addresses = ["mailto:someone-else@example.test"];
    await refuses(() => request("PUT", { ...series, title: "Not organizer" }), "denied");
    await refuses(() => request("DELETE", series), "unknown"); // Shared organizer collection, different session principal: NOT a proven attendee copy.
    addresses = undefined;
    await refuses(() => request("PUT", { ...series, title: "Unknown organizer" }), "unknown");
    addresses = ["mailto:owner@example.test"];
    assert.equal((await request("PUT", { ...series, title: "Safe title" })).status, 200);
    assert.match(davData, /SUMMARY:Detached/);
    assert.match(davData, /RECURRENCE-ID/);
    await db.insert(calendarMembers).values({ userID: viewer, calendarID: dav.id, role: "viewer" });
    reads.length = 0;
    await refuses(() => request("PUT", series, "/events", viewerToken.raw), "denied");
    assert.equal(reads.length, 0, "A collaborator's viewer ACL never opens provider reads");
    // Discovery must not project unknown or read-only as owner.
    privileges = undefined;
    const discovery = await caldavAdapter.listCalendars(owner, davAccount.id);
    assert.equal(discovery.calendars[0]?.readOnly, true);
    for (const grant of ["read", "bind", "write-content", "unbind", "write"]) {
      privileges = [grant];
      assert.equal((await caldavAdapter.listCalendars(owner, davAccount.id)).calendars[0]?.readOnly, grant === "read");
    }
    // New-calendar import has the explicitly approved empty-calendar boundary.
    const recurringIcs = originalResource;
    const importIcs = (provider: string, accountId: string, data: string) => fetch(`${apiOrigin}/import?provider=${provider}&accountId=${accountId}`, { method: "POST", headers: { authorization: `Bearer ${token.raw}`, "content-type": "text/calendar" }, body: data });
    const calendarCount = async () => (await db.select().from(calendars).where(eq(calendars.creatorID, owner))).length;
    let count = await calendarCount();
    const remoteCount = remoteCalendarCreates;
    await refuses(() => importIcs("microsoft", "primary", recurringIcs), "unsupported");
    assert.equal(await calendarCount(), count);
    assert.equal(remoteCalendarCreates, remoteCount);
    // Graph new collection canEdit is only discoverable after CREATE.
    for (canEdit of [false, undefined]) {
      const error = await refuses(() => importIcs("microsoft", "primary", originalResource.replace(/RRULE:FREQ=WEEKLY\r\n/, "")), canEdit === false ? "denied" : "unknown");
      assert.match(error.error, /calendar remains empty/);
      assert.equal(await calendarCount(), ++count);
    }
    canEdit = true;
    assert.equal((await importIcs("microsoft", "primary", originalResource.replace(/RRULE:FREQ=WEEKLY\r\n/, ""))).status, 201);
    console.log("K04 authenticated event capabilities + provider HTTP + DB: OK");
  } finally {
    globalThis.fetch = realFetch;
    await db.delete(user).where(inArray(user.id, [owner, viewer]));
    await db.$client.end();
    await Promise.all([new Promise<void>((resolve) => api.close(() => resolve())), new Promise<void>((resolve) => fixture.close(() => resolve()))]);
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
