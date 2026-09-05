import { eventPatchRequest, type EventWriteRequest } from "@musubi/types";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import express from "express";
import { eq } from "drizzle-orm";
import {
  account, CALENDAR_SCOPE, calendarEvents, createEvent,
  patchEventAndCalendarLinks,
  db, events, externalEvents,
  getEvent, getExternalEvent, importExternalCalendar, importExternalEvent, memberTokens,
  saveCaldavAccount, setExternalEventSyncData, unlinkEventAndTombstoneIfOrphaned, user,
} from "@musubi/db";
import { CLIENT_VERSION_HEADER, EventSchema, PRODUCT_VERSION,
} from "@musubi/types";
import { googleAdapter } from "./google";
import { caldavAdapter, icalToNormalized } from "./caldav";
import { ProviderEventWriteError } from "../event_write";
import { EventDeliveryError, prepareEventWrites } from "../engine";
import { encryptSecret } from "../crypto";
import { issueMemberToken } from "../../federation_tokens";
import { requireAuth } from "../../middleware/require_auth";
import { middlewareErrorHandler } from "../../middleware/error_handler";
import { handlerUpdateEvent, handlerRemoveEvent } from "../../handlers/events";

// This fixture proves actual adapter/handler HTTP behavior, not provider-side
// enforcement. Google Calendar docs and RFC 4791/9110 supply that contract.
const richIcs = [
  "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Unknown vendor//Calendar//EN",
  'X-CALENDAR-EXTRA;X-PARAM="urn:calendar":keep\\,all',
  "BEGIN:VTIMEZONE", "TZID:Europe/Prague", "X-ZONE:opaque",
  "BEGIN:STANDARD", "DTSTART:19701025T030000", "TZOFFSETFROM:+0200", "TZOFFSETTO:+0100",
  "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU", "END:STANDARD",
  "BEGIN:DAYLIGHT", "DTSTART:19700329T020000", "TZOFFSETFROM:+0100", "TZOFFSETTO:+0200",
  "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU", "END:DAYLIGHT", "END:VTIMEZONE",
  "BEGIN:VEVENT", "UID:rich@example.test", "SEQUENCE:42", "DTSTAMP:20260101T000000Z",
  'DTSTART;TZID=Europe/Prague;X-TIME="urn:time":20260101T100000',
  "DTEND;TZID=Europe/Prague:20260101T110000", "RRULE:FREQ=WEEKLY",
  'SUMMARY;LANGUAGE=cs;X-TITLE="urn:title":Before',
  'DESCRIPTION;ALTREP="cid:part1.0001@example.test":Text\\nwith folded',
  "\t continuation and \\, escaping", 'X-ALT-DESC;FMTTYPE=text/html:<b>Rich</b>',
  'LOCATION;LANGUAGE=cs;X-COORD="geo:50,14":Room\\, 2',
  'X-APPLE-STRUCTURED-LOCATION;VALUE=URI;X-TITLE="Room 2":geo:50,14',
  'ATTENDEE;CN="Guest: Person";ROLE=REQ-PARTICIPANT;X-UNKNOWN=YES:mailto:guest@example.test',
  'X-UNKNOWN;VALUE=TEXT;X-QUOTED="a:b;c":one\\,two',
  "X-FOLDED:preserve this long line exactly", " and its folding", "\tand tab",
  "BEGIN:VALARM", "ACTION:DISPLAY", "TRIGGER:-PT15M", "DESCRIPTION:Alarm text",
  'X-ALARM;X-ARG="urn:alarm":keep', "END:VALARM",
  "BEGIN:X-CUSTOM", "X-PROP;X-PARAM=opaque:unknown component", "END:X-CUSTOM", "END:VEVENT",
  "BEGIN:VEVENT", "UID:rich@example.test", "RECURRENCE-ID;TZID=Europe/Prague:20260108T100000",
  "DTSTART;TZID=Europe/Prague:20260108T120000", "DTEND;TZID=Europe/Prague:20260108T130000",
  "SUMMARY:Detached", "X-EXCEPTION;X-KEEP=YES:keep all", "END:VEVENT", "END:VCALENDAR", "",
].join("\r\n");

type Remote = { etag: string | null; data?: string; json?: Record<string, unknown> };

async function main() {
  assert.equal(process.env.ENVIRONMENT, "test");
  assert.ok(process.env.DATABASE_URL);
  const owner = `k06-providers-${randomUUID()}`;
  const token = issueMemberToken();
  const requests: {
    method: string;
    path: string;
    auth: string;
    ifMatch?: string;
    body: string;
  }[] = [];
  const remote = new Map<string, Remote>();
  let nextVersion = 0;
  let writeStatus = 200;
  let omitWriteEtag = false;
  let weakWriteEtag = false;
  let readEtag: string | null | undefined;
  let transformAfterWrite = false;
  let disconnectWrite = false;
  let malformedWrite = false;
  let partialRead = false;
  let invalidUtf8Read = false;
  let beforeEventRead: (() => Promise<void>) | undefined;
  let deniedWriteAuth: string | undefined;
  const key = (auth: string, path: string) => `${auth}:${path}`;
  const fixture = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      const path = new URL(req.url!, "http://fixture.test").pathname;
      const method = req.method!;
      const auth = req.headers.authorization ?? "";
      requests.push({ method, path, auth, ifMatch: req.headers["if-match"] as string | undefined, body });
      const json = (value: unknown, status = 200) => {
        res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(value));
      };
      const xml = (props: string) => {
        res.writeHead(207, { "content-type": "application/xml" });
        res.end(`<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:response><d:href>${path}</d:href><d:propstat><d:prop>${props}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>`);
      };
      const stored = remote.get(key(auth, path));
      if (method === "GET" && path.includes("/calendarList/")) return json({ accessRole: "owner" });
      if (method === "GET" && path.endsWith("/events")) {
        return json({ items: [...remote.entries()].filter(([entry]) => entry.startsWith(`${auth}:${path}/`))
            .map(([, value]) => ({ ...value.json, etag: value.etag })),
          nextSyncToken: "cursor",
        });
      }
      if (method === "GET") {
        if (!stored) return json({}, 404);
        const etag = readEtag === undefined ? stored.etag : readEtag;
        if (stored.data !== undefined) {
          res.writeHead(partialRead ? 206 : 200, {
            "content-type": "text/calendar",
            ...(etag === null ? {} : { etag }),
          });
          return res.end(
            invalidUtf8Read
              ? Buffer.concat([Buffer.from(stored.data), Buffer.from([0xff])])
              : stored.data,
          );
        }
        const send = () => json({ ...stored.json, etag, organizer: { self: true } });
        if (beforeEventRead) { const action = beforeEventRead; beforeEventRead = undefined; void action().then(send); return; }
        return send();
      }
      if (method === "PROPFIND")
        return xml(
          body.includes("current-user-privilege-set")
            ? "<d:current-user-privilege-set><d:privilege><d:write/></d:privilege></d:current-user-privilege-set>"
            : "<d:current-user-principal><d:href>/dav/principal/</d:href></d:current-user-principal><c:calendar-home-set><d:href>/dav/</d:href></c:calendar-home-set>",
        );
      if (method === "REPORT")
        return json(
          { error: "Preserving writes must GET, never projected REPORT" },
          409,
        );
      if (["PATCH", "PUT", "DELETE", "POST"].includes(method)) {
        if (disconnectWrite) {
          req.socket.destroy();
          return;
        }
        if (writeStatus === 303) {
          res.writeHead(303, { location: "/unexpected-redirect" });
          return res.end();
        }
        if (deniedWriteAuth === auth) return json({}, 412);
        if (writeStatus !== 200) return json({}, writeStatus);
        if (method === "DELETE") {
          remote.delete(key(auth, path));
          res.writeHead(204);
          return res.end();
        }
        const etag = `"written-${++nextVersion}"`;
        const responseEtag = omitWriteEtag ? null : weakWriteEtag ? `W/${etag}` : etag;
        if (path.startsWith("/dav/")) {
          remote.set(key(auth, path), { etag, data: body + (transformAfterWrite ? "\r\n" : "") });
          res.writeHead(204, responseEtag === null ? {} : { etag: responseEtag }); return res.end();
        }
        const id = method === "POST" ? `created-${nextVersion}` : stored?.json?.id ?? "same-remote-id";
        remote.set(key(auth, method === "POST" ? `${path}/${id}` : path), {
          etag, json: { ...stored?.json, ...JSON.parse(body), id },
        });
        if (malformedWrite) { res.writeHead(200, { "content-type": "application/json" }); return res.end("{"); }
        return json({ id, ...(responseEtag === null ? {} : { etag: responseEtag }) });
      }
      return json({ error: `Unexpected ${method} ${path}` }, 500);
    });
  });
  await new Promise<void>((resolve) => fixture.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(fixture.address() as { port: number }).port}`;
  const app = express();
  app.use(express.json());
  app.patch("/events", requireAuth, handlerUpdateEvent);
  app.put("/events", requireAuth, handlerUpdateEvent);
  app.delete("/events", requireAuth, handlerRemoveEvent);
  app.use(middlewareErrorHandler);
  const api = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => api.once("listening", resolve));
  const apiOrigin = `http://127.0.0.1:${(api.address() as { port: number }).port}`;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const url = new URL(String(input));
    if ([origin, apiOrigin].includes(url.origin)) return realFetch(input, init);
    assert.equal(url.origin, "https://www.googleapis.com", `No live provider calls: ${url}`);
    return realFetch(`${origin}${url.pathname}${url.search}`, init);
  };
  const mutationRequests = () =>
    requests.filter(({ method }) =>
      ["POST", "PATCH", "PUT", "DELETE"].includes(method),
    );
  // Provider scenarios seed a fresh authoritative draft for each independent operation.
  // Stale/local-CAS races are exercised by event_revision.integration.test.ts.
  const request = async (method: string, event: EventWriteRequest) =>
    fetch(`${apiOrigin}/events`, {
    method, headers: { authorization: `Bearer ${token.raw}`,
        "content-type": "application/json",
        [CLIENT_VERSION_HEADER]: PRODUCT_VERSION,
      },
      body: JSON.stringify(
        method === "DELETE"
          ? {
              id: event.id,
              expectedRevision: (await getEvent(event.id)).revision,
            }
          : eventPatchRequest({
              ...event,
              revision: (await getEvent(event.id)).revision,
            }),
      ),
    });
  const snapshot = async () =>
    JSON.stringify([
      await db.select().from(events).orderBy(events.id),
      await db
        .select()
        .from(calendarEvents)
        .orderBy(calendarEvents.eventID, calendarEvents.calendarID),
      await db.select().from(externalEvents).orderBy(externalEvents.id),
    ]);
  const noMutation = async (run: () => Promise<unknown>) => {
    const before = await snapshot();
    const count = mutationRequests().length;
    await run();
    assert.equal(
      mutationRequests().length,
      count,
      "No remote mutation on preflight refusal",
    );
    assert.equal(
      await snapshot(),
      before,
      "No local/link/mapping mutation on preflight refusal",
    );
  };
  const providerError = (code: string) => (error: unknown) =>
    error instanceof ProviderEventWriteError && error.code === code;
  const eventIn = (calendars: string[]) =>
    EventSchema.parse({
      id: randomUUID(),
      creatorID: owner,
      organizer: owner,
      title: "Before",
      color: "#7A8BA3",
      start: "2026-01-01T09:00:00Z",
      end: "2026-01-01T10:00:00Z",
      isAllDay: false,
      isCanceled: false,
      calendars,
      originCalendarID: calendars[0],
      description: "<b>Rich HTML</b>",
      location: "Room",
    });
  await db.insert(user).values({
    id: owner,
    name: owner,
    email: `${owner}@example.test`,
    isExternal: true,
  });
  try {
    await db
      .insert(memberTokens)
      .values({ userID: owner, tokenHash: token.tokenHash });
    await db.insert(account).values(
      ["primary", "sibling"].map((accountId) => ({
        id: randomUUID(),
        userId: owner,
        providerId: "google",
        accountId,
        scope: CALENDAR_SCOPE.google,
        accessToken: `${accountId}-access`,
        refreshToken: "fixture",
        accessTokenExpiresAt: new Date(Date.now() + 3600_000),
      })),
    );
    const mirrors = await Promise.all(
      ["primary", "sibling"].map((accountID) =>
        importExternalCalendar("google", owner, accountID, accountID, {
          externalId: "same-calendar",
          name: accountID,
          color: "#7A8BA3",
        }),
      ),
    );
    const googlePath =
      "/calendar/v3/calendars/same-calendar/events/same-remote-id";
    const googleEvent = eventIn([mirrors[0].id]);
    const opaque = '"G,opaque\\validator"';
    const googleJson = {
      id: "same-remote-id",
      summary: "Before",
      description: "<b>Rich HTML</b>",
      location: "Room",
      start: { dateTime: googleEvent.start.toISOString() },
      end: { dateTime: googleEvent.end.toISOString() },
      attendees: [{ email: "guest@example.test" }],
      extendedProperties: { private: { unknown: "keep" } },
    };
    remote.set(key("Bearer primary-access", googlePath), {
      etag: opaque,
      json: googleJson,
    });
    remote.set(key("Bearer sibling-access", googlePath), {
      etag: '"sibling"',
      json: googleJson,
    });
    const pulled = await googleAdapter.fetchChanges(
      owner,
      "primary",
      "same-calendar",
      null,
    );
    assert.equal(
      pulled.changes[0].data.etag,
      opaque,
      "Google EVENT read captures exact opaque ETag",
    );
    await createEvent(googleEvent, googleEvent.calendars);
    await importExternalEvent(
      "google",
      googleEvent.id,
      mirrors[0].id,
      "same-calendar",
      "same-remote-id",
      opaque,
    );
    // Same remote ID in another account/local calendar cannot contaminate this mapping.
    await importExternalEvent(
      "google",
      googleEvent.id,
      mirrors[1].id,
      "same-calendar",
      "same-remote-id",
      '"sibling"',
    );
    requests.length = 0;
    const googleTitle = { ...googleEvent, title: "Title only" };
    assert.equal((await request("PUT", googleTitle)).status, 200);
    assert.deepEqual(
      mutationRequests().map(({ method, ifMatch, body, auth }) => ({
        method,
        ifMatch,
        body: JSON.parse(body),
        auth,
      })),
      [
        {
          method: "PATCH",
          ifMatch: opaque,
          body: { summary: "Title only" },
          auth: "Bearer primary-access",
        },
      ],
    );
    const googleRef = (await getExternalEvent(
      "google",
      googleEvent.id,
      "same-calendar",
      mirrors[0].id,
    ))!;
    assert.equal(
      googleRef.etag,
      remote.get(key("Bearer primary-access", googlePath))!.etag,
    );
    assert.equal(
      (await getExternalEvent(
        "google",
        googleEvent.id,
        "same-calendar",
        mirrors[1].id,
      ))!.etag,
      '"sibling"',
    );
    assert.deepEqual(
      remote.get(key("Bearer primary-access", googlePath))!.json?.attendees,
      googleJson.attendees,
    );
    await noMutation(async () => {
      await assert.rejects(
        () =>
          googleAdapter.pushUpdate(
            owner,
            "primary",
            "same-calendar",
            "same-remote-id",
            googleTitle,
            googleRef,
          ),
        providerError("event-diff-unavailable"),
      );
      await assert.rejects(
        () =>
          prepareEventWrites([
            {
              action: "update",
              event: googleTitle,
              calendarIDs: googleTitle.calendars,
            },
          ]),
        providerError("event-diff-unavailable"),
      );
    });
    for (const etag of [
      null,
      "",
      "*",
      "unquoted",
      'W/"weak"',
      ' "space"',
      '"bad\nline"',
    ]) {
      await noMutation(async () => {
        await assert.rejects(
          () =>
            googleAdapter.pushUpdate(
              owner,
              "primary",
              "same-calendar",
              "same-remote-id",
              googleTitle,
              { ...googleRef, etag },
              { title: googleTitle.title },
            ),
          providerError("provider-version-unavailable"),
        );
        await assert.rejects(
          () =>
            googleAdapter.pushDelete(
              owner,
              "primary",
              "same-calendar",
              "same-remote-id",
              { ...googleRef, etag },
            ),
          providerError("provider-version-unavailable"),
        );
      });
    }
    for (const fresh of ['"unseen"', null, 'W/"weak"']) {
      readEtag = fresh;
      await noMutation(async () =>
        assert.equal(
          (await request("PUT", { ...googleTitle, title: "Refused" })).status,
          409,
        ),
      );
    }
    readEtag = undefined;
    await noMutation(async () => {
      await googleAdapter.pushUpdate(
        owner,
        "primary",
        "same-calendar",
        "same-remote-id",
        googleTitle,
        googleRef,
        {},
      );
    });
    const cleared = await googleAdapter.pushUpdate(
      owner,
      "primary",
      "same-calendar",
      "same-remote-id",
      { ...googleTitle, description: null },
      googleRef,
      { description: null },
    );
    assert.deepEqual(
      JSON.parse(mutationRequests()[mutationRequests().length - 1].body),
      { description: null },
    );
    assert.ok(cleared?.etag);
    await setExternalEventSyncData(
      "google",
      googleEvent.id,
      "same-calendar",
      { etag: cleared.etag, icalUid: null },
      mirrors[0].id,
    );

    // Provider 412 is visible, never retried or swallowed. Current legacy handler
    // commits locally first for update, but cannot yet expose a K06 UI receipt.
    writeStatus = 412;
    requests.length = 0;
    assert.equal(
      (
        await request("PUT", {
          ...googleTitle,
          title: "Locally committed conflict",
        })
      ).status,
      409,
    );
    assert.equal(
      (await getEvent(googleEvent.id)).title,
      "Locally committed conflict",
    );
    assert.equal(mutationRequests().length, 1);
    assert.equal(mutationRequests()[0].ifMatch, cleared.etag);
    assert.equal(
      (await getExternalEvent(
        "google",
        googleEvent.id,
        "same-calendar",
        mirrors[0].id,
      ))!.etag,
      cleared.etag,
    );
    const deleteEvent = { ...googleEvent, id: randomUUID() };
    await createEvent(deleteEvent, deleteEvent.calendars);
    await importExternalEvent(
      "google",
      deleteEvent.id,
      mirrors[0].id,
      "same-calendar",
      "delete-conflict",
      cleared.etag,
    );
    const deletedConflict = await request("DELETE", deleteEvent);
    assert.equal(deletedConflict.status, 409);
    const deletionReceipt = await deletedConflict.json();
    assert.equal(deletionReceipt.localCommitted, true);
    assert.equal(deletionReceipt.currentRevision, 2);
    assert.ok((await getEvent(deleteEvent.id)).deletedAt);
    writeStatus = 202;
    await assert.rejects(
      () =>
        googleAdapter.pushDelete(
          owner,
          "primary",
          "same-calendar",
          "same-remote-id",
          { ...googleRef, etag: cleared.etag },
        ),
      (error: unknown) =>
        error instanceof ProviderEventWriteError &&
        error.outcome === "unconfirmed",
    );
    writeStatus = 303;
    const redirectsBefore = requests.length;
    await assert.rejects(() =>
      googleAdapter.pushDelete(
        owner,
        "primary",
        "same-calendar",
        "same-remote-id",
        { ...googleRef, etag: cleared.etag },
      ),
    );
    assert.equal(
      requests.length,
      redirectsBefore + 1,
      "Google conditional writes never follow redirects to GET",
    );
    writeStatus = 200;

    // Prepared refs and receipts remain scoped and survive local mapping removal.
    const deletes = await prepareEventWrites([
      {
        action: "delete",
        event: googleTitle,
        calendarIDs: [mirrors[0].id, mirrors[1].id],
      },
    ]);
    await unlinkEventAndTombstoneIfOrphaned(googleEvent.id, [
      mirrors[0].id,
      mirrors[1].id,
    ]);
    requests.length = 0;
    const deleted = await deletes();
    assert.deepEqual(
      deleted.map(({ status }) => status),
      ["completed", "completed"],
    );
    assert.deepEqual(
      mutationRequests().map(({ ifMatch, auth }) => ({ ifMatch, auth })),
      [
        { ifMatch: cleared.etag, auth: "Bearer primary-access" },
        { ifMatch: '"sibling"', auth: "Bearer sibling-access" },
      ],
    );
    await deletes();
    assert.equal(
      mutationRequests().length,
      2,
      "Prepared closure cannot re-send completed writes",
    );

    // Successful writes never invent or carry forward validators; create and
    // update return null when absent/weak instead of accepting an unseen GET.
    for (const weak of [false, true]) {
      omitWriteEtag = !weak;
      weakWriteEtag = weak;
      const created = await googleAdapter.pushCreate(
        owner,
        "primary",
        "same-calendar",
        googleEvent,
      );
      assert.equal(created.etag, null);
    }
    omitWriteEtag = false;
    weakWriteEtag = false;
    malformedWrite = true;
    await assert.rejects(
      () =>
        googleAdapter.pushCreate(
          owner,
          "primary",
          "same-calendar",
          googleEvent,
        ),
      (error: unknown) =>
        error instanceof ProviderEventWriteError &&
        error.outcome === "unconfirmed",
    );
    malformedWrite = false;

    const davAccount = await saveCaldavAccount(
      owner,
      `${origin}/dav/`, "owner", encryptSecret("fixture-password"));
    const davAuth = `Basic ${Buffer.from("owner:fixture-password").toString("base64")}`;
    const davCalendar = `${origin}/dav/cal/`;
    const davPath = "/dav/cal/rich.ics";
    const davUrl = `${origin}${davPath}`;
    const dav = await importExternalCalendar(
      "caldav",
      owner,
      davAccount.id,
      "DAV",
      { externalId: davCalendar, name: "DAV", color: "#7A8BA3" },
    );
    const normalized = icalToNormalized({ url: davUrl, data: richIcs })!;
    assert.ok(normalized);
    const davEvent = {
      ...eventIn([dav.id]),
      ...normalized,
      id: randomUUID(),
      organizer: owner,
    };
    const davRef = {
      externalEventId: davUrl,
      etag: '"DAV,opaque\\tag"',
      icalUid: "rich@example.test",
    };
    remote.set(key(davAuth, davPath), { etag: davRef.etag, data: richIcs });
    await createEvent(davEvent, davEvent.calendars);
    await importExternalEvent(
      "caldav",
      davEvent.id,
      dav.id,
      davCalendar,
      davUrl,
      davRef.etag,
      davRef.icalUid,
    );
    requests.length = 0;
    const davTitle = { ...davEvent, title: "Changed" };
    assert.equal((await request("PUT", davTitle)).status, 200);
    const preserved = richIcs.replace(":Before\r\n", ":Changed\r\n");
    assert.equal(
      remote.get(key(davAuth, davPath))!.data,
      preserved,
      "COMPLETE byte equality except selected SUMMARY: folded properties, parameters, nested components, UID and detached exceptions",
    );
    assert.deepEqual(
      mutationRequests().map(({ method, ifMatch, body }) => ({
        method,
        ifMatch,
        body,
      })),
      [{ method: "PUT", ifMatch: davRef.etag, body: preserved }],
    );
    assert.equal(
      requests.filter(({ method }) => method === "REPORT").length,
      0,
    );
    const currentDavRef = (await getExternalEvent(
      "caldav",
      davEvent.id,
      davCalendar,
      dav.id,
    ))!;
    assert.equal(currentDavRef.etag, remote.get(key(davAuth, davPath))!.etag);
    for (const etag of [
      null,
      "",
      "*",
      "unquoted",
      'W/"weak"',
      ' "space"',
      '"bad\nline"',
    ]) {
      await noMutation(async () => {
        await assert.rejects(
          () =>
            caldavAdapter.pushUpdate(
              owner,
              davAccount.id,
              davCalendar,
              davUrl,
              davTitle,
              { ...currentDavRef, etag },
              { title: "Changed" },
            ),
          providerError("provider-version-unavailable"),
        );
        await assert.rejects(
          () =>
            caldavAdapter.pushDelete(
              owner,
              davAccount.id,
              davCalendar,
              davUrl,
              { ...currentDavRef, etag },
            ),
          providerError("provider-version-unavailable"),
        );
      });
    }
    for (const fresh of ['"unseen"', null, 'W/"weak"']) {
      readEtag = fresh;
      await noMutation(async () => {
        await assert.rejects(
          () =>
            caldavAdapter.pushUpdate(
              owner,
              davAccount.id,
              davCalendar,
              davUrl,
              davTitle,
              currentDavRef,
              { title: "Changed" },
            ),
          providerError(
            fresh === '"unseen"'
              ? "provider-conflict"
              : "provider-version-unavailable",
          ),
        );
        assert.equal(
          (await request("PUT", { ...davTitle, title: "Refused" })).status,
          409,
        );
        assert.equal((await request("DELETE", davTitle)).status, 409);
      });
    }
    readEtag = undefined;
    await noMutation(async () => {
      await assert.rejects(
        () =>
          caldavAdapter.pushUpdate(
            owner,
            davAccount.id,
            davCalendar,
            davUrl,
            davTitle,
            currentDavRef,
          ),
        providerError("event-diff-unavailable"),
      );
      await assert.rejects(
        () =>
          caldavAdapter.pushUpdate(
            owner,
            davAccount.id,
            davCalendar,
            davUrl,
            { ...davTitle, recurrence: "RRULE:FREQ=DAILY" },
            currentDavRef,
            { recurrence: "RRULE:FREQ=DAILY" },
          ),
        /detached exceptions/,
      );
    });
    for (const invalid of ["partial", "utf8"]) {
      partialRead = invalid === "partial";
      invalidUtf8Read = invalid === "utf8";
      await noMutation(async () =>
        assert.notEqual(
          (await request("PUT", { ...davTitle, title: "Incomplete read" }))
            .status,
          200,
        ),
      );
    }
    partialRead = false;
    invalidUtf8Read = false;
    // Ambiguous/malformed masters never get guessed or PUT.
    for (const invalid of [
      preserved.replace(
        "END:VCALENDAR",
        "BEGIN:VEVENT\r\nUID:rich@example.test\r\nEND:VEVENT\r\nEND:VCALENDAR",
      ),
      preserved.replace("UID:rich@example.test", "UID:other"),
      preserved.replace("END:X-CUSTOM", "END:VALARM"),
    ]) {
      remote.set(key(davAuth, davPath), {
        etag: currentDavRef.etag!,
        data: invalid,
      });
      await noMutation(async () =>
        assert.notEqual(
          (await request("PUT", { ...davTitle, title: "No guessing" })).status,
          200,
        ),
      );
    }
    remote.set(key(davAuth, davPath), {
      etag: currentDavRef.etag!,
      data: preserved,
    });

    // A fresh GET after preflight is allowed only at the previously accepted
    // version. Changed read version rejects without accepting/rebasing it.
    const changedAfterPreflight = await prepareEventWrites([
      {
        action: "update",
        event: { ...davTitle, title: "Later" },
        previous: davTitle,
        calendarIDs: [dav.id],
      },
    ]);
    remote.get(key(davAuth, davPath))!.etag = '"concurrent"';
    const countBefore = mutationRequests().length;
    await assert.rejects(
      changedAfterPreflight,
      (error: unknown) =>
        error instanceof EventDeliveryError &&
        error.receipts[0].status === "conflict" &&
        providerError("provider-conflict")(error.failure),
    );
    assert.equal(mutationRequests().length, countBefore);
    assert.equal(
      (await getExternalEvent("caldav", davEvent.id, davCalendar, dav.id))!
        .etag,
      currentDavRef.etag,
    );
    remote.get(key(davAuth, davPath))!.etag = currentDavRef.etag!;

    // Mixed target delivery reports completed + conflict; later targets remain
    // not-attempted and a failing closure never becomes an unconditional retry.
    const createForPartial = eventIn([mirrors[0].id]);
    await createEvent(createForPartial, createForPartial.calendars);
    const partial = await prepareEventWrites([
      {
        action: "create",
        event: createForPartial,
        calendarIDs: [mirrors[0].id],
      },
      {
        action: "update",
        event: { ...davTitle, title: "Conflict" },
        previous: davTitle,
        calendarIDs: [dav.id],
      },
      { action: "delete", event: davTitle, calendarIDs: [dav.id] },
    ]);
    await partial("create");
    writeStatus = 412;
    requests.length = 0;
    await assert.rejects(
      () => partial("update"),
      (error: unknown) =>
        error instanceof EventDeliveryError &&
        error.receipts.map(({ status }) => status).join(",") ===
          "completed,conflict,not-attempted" &&
        error.failure instanceof ProviderEventWriteError &&
        error.failure.providerStatus === 412,
    );
    assert.equal(mutationRequests().length, 1);
    assert.equal(mutationRequests()[0].ifMatch, currentDavRef.etag);
    await assert.rejects(() => partial("delete"), EventDeliveryError);
    assert.equal(
      mutationRequests().length,
      1,
      "Failure is latched: no retry or later destructive delivery",
    );
    await assert.rejects(
      () =>
        caldavAdapter.pushDelete(
          owner,
          davAccount.id,
          davCalendar,
          davUrl,
          currentDavRef,
        ),
      providerError("provider-conflict"),
    );
    assert.equal(mutationRequests()[1].method, "DELETE");
    assert.equal(mutationRequests()[1].ifMatch, currentDavRef.etag);
    writeStatus = 303;
    const davRedirectsBefore = requests.length;
    await assert.rejects(
      () =>
        caldavAdapter.pushDelete(
          owner,
          davAccount.id,
          davCalendar,
          davUrl,
          currentDavRef,
        ),
      /conditional mutation cannot redirect to GET/,
    );
    assert.equal(requests.length, davRedirectsBefore + 1);
    writeStatus = 202;
    await assert.rejects(
      () =>
        caldavAdapter.pushDelete(
          owner,
          davAccount.id,
          davCalendar,
          davUrl,
          currentDavRef,
        ),
      (error: unknown) =>
        error instanceof ProviderEventWriteError &&
        error.outcome === "unconfirmed" &&
        error.providerStatus === 202,
    );
    writeStatus = 200;
    assert.equal(remote.get(key(davAuth, davPath))!.data, preserved);

    // Ordinary (nonrecurring) resource: changed nullable property only, then
    // start-only editing materializes the intended DTEND instead of sliding it
    // through DURATION. Unrelated alarm/extension lines remain literal bytes.
    const ordinaryPath = "/dav/cal/ordinary.ics";
    const ordinaryUrl = `${origin}${ordinaryPath}`;
    const ordinaryData = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "BEGIN:VEVENT",
      "UID:ordinary",
      "DTSTART:20260101T100000Z",
      "DURATION:PT1H",
      "SUMMARY:Ordinary",
      "LOCATION;X-KEEP=YES:Room",
      "X-UNKNOWN:keep",
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      "TRIGGER:-PT5M",
      "DESCRIPTION:keep alarm",
      "END:VALARM",
      "END:VEVENT",
      "END:VCALENDAR",
      "",
    ].join("\r\n");
    remote.set(key(davAuth, ordinaryPath), {
      etag: '"ordinary"',
      data: ordinaryData,
    });
    const ordinary = {
      ...eventIn([dav.id]),
      ...icalToNormalized({ url: ordinaryUrl, data: ordinaryData })!,
      id: randomUUID(),
      organizer: owner,
    };
    let ordinaryRef = {
      externalEventId: ordinaryUrl,
      etag: '"ordinary"',
      icalUid: "ordinary",
    };
    const ordinaryCleared = await caldavAdapter.pushUpdate(
      owner,
      davAccount.id,
      davCalendar,
      ordinaryUrl,
      { ...ordinary, location: null },
      ordinaryRef,
      { location: null },
    );
    assert.ok(ordinaryCleared?.etag);
    assert.equal(
      remote.get(key(davAuth, ordinaryPath))!.data,
      ordinaryData.replace("LOCATION;X-KEEP=YES:Room\r\n", ""),
    );
    ordinaryRef = { ...ordinaryRef, etag: ordinaryCleared.etag };
    await caldavAdapter.pushUpdate(
      owner,
      davAccount.id,
      davCalendar,
      ordinaryUrl,
      { ...ordinary, start: new Date("2026-01-01T10:30:00Z") },
      ordinaryRef,
      { start: new Date("2026-01-01T10:30:00Z") },
    );
    const movedData = remote.get(key(davAuth, ordinaryPath))!.data!;
    assert.equal(
      icalToNormalized({
        url: ordinaryUrl,
        data: movedData,
      })?.end.toISOString(),
      "2026-01-01T11:00:00.000Z",
    );
    assert.doesNotMatch(movedData, /DURATION/);
    assert.match(movedData, /X-UNKNOWN:keep\r\nBEGIN:VALARM/);

    // Engine persists a missing Google response validator as NULL, not the old
    // tag, and a subsequent handler write is refused before local mutation.
    omitWriteEtag = true;
    assert.equal(
      (
        await request("PUT", {
          ...createForPartial,
          title: "No response validator",
        })
      ).status,
      200,
    );
    assert.equal(
      (await getExternalEvent(
        "google",
        createForPartial.id,
        "same-calendar",
        mirrors[0].id,
      ))!.etag,
      null,
    );
    await noMutation(async () =>
      assert.equal(
        (await request("PUT", { ...createForPartial, title: "Must refresh" }))
          .status,
        409,
      ),
    );
    omitWriteEtag = false;

    // Missing/transformed write responses clear mapping ETag; no follow-up GET
    // may silently bless provider transformations or concurrent user changes.
    const acceptedDavEtag = currentDavRef.etag;
    for (const weak of [false, true]) {
      // Restore isolated fixture/accepted mapping before each independent case.
      remote.set(key(davAuth, davPath), {
        etag: acceptedDavEtag!,
        data: preserved,
      });
      await setExternalEventSyncData(
        "caldav",
        davEvent.id,
        davCalendar,
        { etag: acceptedDavEtag, icalUid: davRef.icalUid },
        dav.id,
      );
      omitWriteEtag = !weak;
      weakWriteEtag = weak;
      transformAfterWrite = true;
      const deliverMissing = await prepareEventWrites([
        {
          action: "update",
          event: { ...davTitle, title: `Missing-${weak}` },
          previous: davTitle,
          calendarIDs: [dav.id],
        },
      ]);
      requests.length = 0;
      await deliverMissing();
      assert.equal(
        (await getExternalEvent("caldav", davEvent.id, davCalendar, dav.id))!
          .etag,
        null,
      );
      assert.equal(
        requests.filter(({ method }) => method === "GET").length,
        1,
        "Only the same-version pre-write GET",
      );
      await noMutation(async () =>
        assert.equal(
          (await request("PUT", { ...davTitle, title: "Must refresh" })).status,
          409,
        ),
      );
      const created = await caldavAdapter.pushCreate(
        owner,
        davAccount.id,
        davCalendar,
        eventIn([dav.id]),
      );
      assert.equal(
        created.etag,
        null,
        "CalDAV create also refuses to invent a validator",
      );
    }
    omitWriteEtag = false;
    weakWriteEtag = false;
    transformAfterWrite = false;
    const davCreated = await caldavAdapter.pushCreate(
      owner,
      davAccount.id,
      davCalendar,
      eventIn([dav.id]),
    );
    assert.ok(davCreated.etag);
    assert.equal(
      davCreated.etag,
      remote.get(key(davAuth, new URL(davCreated.externalEventId).pathname))!
        .etag,
    );
    // Whole-resource (whole-series) deletion uses the accepted version even
    // after local unlink removes its mapping, never DELETE an occurrence URL.
    remote.set(key(davAuth, davPath), {
      etag: acceptedDavEtag!,
      data: preserved,
    });
    await setExternalEventSyncData(
      "caldav",
      davEvent.id,
      davCalendar,
      { etag: acceptedDavEtag, icalUid: davRef.icalUid },
      dav.id,
    );
    const deleteDav = await prepareEventWrites([
      { action: "delete", event: davTitle, calendarIDs: [dav.id] },
    ]);
    await unlinkEventAndTombstoneIfOrphaned(davEvent.id, [dav.id]);
    requests.length = 0;
    await deleteDav();
    assert.deepEqual(
      mutationRequests().map(({ method, ifMatch, path }) => ({
        method,
        ifMatch,
        path,
      })),
      [{ method: "DELETE", ifMatch: acceptedDavEtag, path: davPath }],
    );
    assert.equal(remote.has(key(davAuth, davPath)), false);
    disconnectWrite = true;
    const networkFailure = await prepareEventWrites([
      {
        action: "create",
        event: createForPartial,
        calendarIDs: [mirrors[0].id],
      },
    ]);
    await assert.rejects(
      networkFailure,
      (error: unknown) =>
        error instanceof EventDeliveryError &&
        error.receipts[0].status === "unconfirmed",
    );
    disconnectWrite = false;

    // Real authenticated PATCH: a local writer wins AFTER provider preflight
    // starts. The losing CAS must make zero remote mutations.
    const race = eventIn([mirrors[0].id]);
    await createEvent(race, race.calendars);
    const racePath = "/calendar/v3/calendars/same-calendar/events/local-race";
    remote.set(key("Bearer primary-access", racePath), { etag: '"race-v1"', json: { id: "local-race", summary: race.title } });
    await importExternalEvent("google", race.id, mirrors[0].id, "same-calendar", "local-race", '"race-v1"');
    const rawPatch = (eventID: string, revision: number, patch: Record<string, unknown>) => fetch(`${apiOrigin}/events`, {
      method: "PATCH", headers: { authorization: `Bearer ${token.raw}`, "content-type": "application/json", [CLIENT_VERSION_HEADER]: PRODUCT_VERSION },
      body: JSON.stringify({ id: eventID, expectedRevision: revision, patch }),
    });
    requests.length = 0;
    beforeEventRead = async () => { await patchEventAndCalendarLinks(race.id, 1, { start: new Date("2026-01-01T08:00:00Z") }); };
    const lost = await rawPatch(race.id, 1, { title: "Stale title" });
    assert.equal(lost.status, 409); assert.equal((await lost.json()).localCommitted, false);
    assert.equal(mutationRequests().length, 0);
    assert.equal((await getEvent(race.id)).title, race.title);
    assert.equal((await getEvent(race.id)).revision, 2);

    // Known multi-target delivery: first conditional PATCH succeeds, second
    // returns412. Public receipt reveals partial success, no account/resource IDs.
    const partialEvent = eventIn(mirrors.map(mirror => mirror.id));
    await createEvent(partialEvent, partialEvent.calendars);
    const partialPath = "/calendar/v3/calendars/same-calendar/events/http-partial";
    for (const [index, auth] of ["Bearer primary-access", "Bearer sibling-access"].entries()) {
      remote.set(key(auth, partialPath), { etag: '"partial-v1"', json: { id: "http-partial", summary: partialEvent.title } });
      await importExternalEvent("google", partialEvent.id, mirrors[index].id, "same-calendar", "http-partial", '"partial-v1"');
    }
    deniedWriteAuth = "Bearer sibling-access"; requests.length = 0;
    const partialResponse = await rawPatch(partialEvent.id, 1, { title: "Locally saved partial" });
    const receipt = await partialResponse.json();
    assert.equal(partialResponse.status, 409); assert.equal(receipt.localCommitted, true);
    assert.equal(receipt.currentRevision, 2); assert.deepEqual(receipt.delivery, { completed: true, status: "conflict" });
    assert.equal(receipt.current.title, "Locally saved partial");
    assert.equal(mutationRequests().length, 2);
    assert.ok(!JSON.stringify(receipt).includes("sibling-access"));
    assert.ok(!JSON.stringify(receipt).includes("http-partial"));
    deniedWriteAuth = undefined;
    // A response validator cannot overwrite an intervening accepted mapping or
    // acknowledge an event revision that no longer equals its local commit.
    assert.equal(await setExternalEventSyncData("google", partialEvent.id, "same-calendar", { etag: '"late"', icalUid: null }, mirrors[0].id, { revision: 1, etag: '"partial-v1"', externalEventID: "http-partial" }), false);
    console.log("K06 authenticated provider race/partial412/localCommitted and scoped metadata acceptance guards: OK");
    console.log(
      "K06 Google/CalDAV actual adapter + authenticated handler + scoped prepared delivery: OK",
    );
  } finally {
    globalThis.fetch = realFetch;
    await db.delete(user).where(eq(user.id, owner));
    await Promise.all([
      new Promise<void>((resolve) => api.close(() => resolve())),
      new Promise<void>((resolve) => fixture.close(() => resolve())),
    ]);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
