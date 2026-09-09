import { planEventScope, resolveEventTimeEdit } from "@musubi/calendar";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import express from "express";
import { and, eq, sql } from "drizzle-orm";

async function main() {
  assert.equal(process.env.ENVIRONMENT, "test");
  assert.ok(process.env.DATABASE_URL);
  const { config } = await import("@musubi/config");
  const { CLIENT_VERSION_HEADER, PRODUCT_VERSION } = await import("@musubi/types");
  const { db, user, events, calendarEvents, createCalendar, eventOutbox, externalEvents, eventScopeOperations, externalCalendars, externalEventTombstones, saveCaldavAccount, importExternalCalendar, replaceExternalEventResource, getEventSnapshot, replaceMemberToken, applyLocalEventScope, claimEventOutbox, completeEventOutbox, confirmCaldavSeriesOutbox } = await import("@musubi/db");
  const { caldavAdapter } = await import("./adapters/caldav");
  const { normalizeCaldavResource } = await import("./adapters/caldav_time");
  const { prepareCaldavSeries } = await import("./caldav_scope");
  const { prepareEventDeliveryResolution } = await import("./event_resolution");
  const { commitEventDeliveryResolution, getEventDeliveryResolutionReplay } = await import("@musubi/db");
  const { deliverEventOutbox } = await import("./event_delivery");
  const { encryptSecret } = await import("./crypto");
  const { issueMemberToken } = await import("../federation_tokens");
  const { requireAuth } = await import("../middleware/require_auth");
  const { middlewareErrorHandler } = await import("../middleware/error_handler");
  const { handlerEventScope } = await import("../handlers/events");
  const { handlerGetEventDelivery, handlerGetEventDeliveryConflict, handlerResolveEventDelivery } = await import("../handlers/event_delivery");
  let data = "", etag = '"before"', mode = "ok", puts = 0;
  let onPut: (() => Promise<void>) | undefined;
  const fixture = createServer(async (req, res) => {
    if (req.method === "PROPFIND") {
      res.writeHead(207, { "content-type": "application/xml" });
      return res.end(`<d:multistatus xmlns:d="DAV:"><d:response><d:href>${req.url}</d:href><d:propstat><d:prop><d:current-user-privilege-set><d:privilege><d:write-content/></d:privilege></d:current-user-privilege-set></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>`);
    }
    if (req.method === "GET") { res.writeHead(200, { "content-type": "text/calendar", etag }); return res.end(data); }
    assert.equal(req.method, "PUT"); puts++;
    let body = ""; for await (const chunk of req) body += chunk;
    if (mode === "race") { data = data.replace("SUMMARY:Moved", "SUMMARY:Remote child"); etag = '"raced"'; }
    if (req.headers["if-match"] !== etag) { res.writeHead(412); return res.end(); }
    data = body; etag = '"after"';
    await onPut?.();
    res.writeHead(mode === "lost" ? 503 : 204, { etag }); res.end();
  });
  await new Promise<void>(resolve => fixture.listen(0, "127.0.0.1", resolve));
  const provider = `http://127.0.0.1:${(fixture.address() as any).port}`;
  const app = express(); app.use(express.json());
  app.post("/events/:eventId/scope", requireAuth, handlerEventScope);
  app.get("/events/:eventId/delivery", requireAuth, handlerGetEventDelivery);
  app.get("/events/:eventId/delivery/:operationId/conflict", requireAuth, handlerGetEventDeliveryConflict);
  app.post("/events/:eventId/delivery/:operationId/resolve", requireAuth, handlerResolveEventDelivery);
  app.use(middlewareErrorHandler);
  const api = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => api.once("listening", resolve));
  const apiOrigin = `http://127.0.0.1:${(api.address() as any).port}`;
  const enabled = config.api.eventTimeEditsEnabled;
  try {
    for (const scenario of ["series-time-zoned", "series-time-all-day", "series-time-floating", "series-time-lost", "series-time-race", "series-time-tombstone", "generated-time-zoned", "generated-time-all-day", "generated-time-floating", "generated-time-lost", "generated-time-race", "time-zoned", "time-all-day", "time-floating", "time-lost", "time-race", "revive-zoned", "revive-all-day", "revive-floating", "revive-lost", "revive-race", "generated-zoned", "generated-all-day", "generated-floating", "generated-cancel-zoned", "generated-cancel-all-day", "generated-cancel-floating", "generated-lost", "generated-race", "generated-prepare-race", "generated-tombstone", "cancel-zoned", "cancel-all-day", "cancel-floating", "cancel-lost", "cancel-race", "occurrence-zoned", "occurrence-all-day", "occurrence-floating", "occurrence-lost", "occurrence-race", "zoned", "all-day", "floating", "no-children", "malformed-private", "meeting", "copied", "lost", "race", "local-race", "mapping-race", "lease-race", "tombstone", "prepare-race", "no-op", "resolve", "resolve-all-day", "resolve-floating", "resolve-twice", "resolve-http", "resolve-timezone", "resolve-stale", "resolve-local-race", "resolve-child-race"]) {
      const owner = `caldav-scope-${randomUUID()}`;
      const credential = issueMemberToken();
      await db.insert(user).values({ id: owner, name: "Fixture", email: `${owner}@example.test`, isExternal: true });
      await replaceMemberToken(owner, credential.tokenHash);
      config.api.eventTimeEditsEnabled = true;
      try {
        const account = await saveCaldavAccount(owner, provider + "/", "fixture", encryptSecret("fixture"));
        const collection = provider + "/collection/";
        const calendar = await importExternalCalendar("caldav", owner, account.id, "Fixture", { externalId: collection, name: "Fixture", color: "#7A8BA3", supportsEvents: true });
        const resource = collection + "family.ics";
        const stamp = (name: string, day: string, hour: string) => scenario.endsWith("all-day") ? `${name};VALUE=DATE:202603${day}` : `${name}${scenario.endsWith("floating") ? "" : ";TZID=Europe/Prague"}:202603${day}T${hour}0000`;
        const component = (...lines: string[]) => ["BEGIN:VEVENT", "UID:family", ...lines, "END:VEVENT"].join("\r\n");
        const master = component(stamp("DTSTART", "28", "09"), stamp("DTEND", "29", "10"), "RRULE:FREQ=DAILY;COUNT=4", "SUMMARY:Master", "X-PRIVATE:Never disclose", "BEGIN:VALARM", "ACTION:DISPLAY", "TRIGGER:-PT15M", "DESCRIPTION:Private alarm", "END:VALARM");
        const child = component(stamp("RECURRENCE-ID", "29", "09"), stamp("DTSTART", "30", "14"), stamp("DTEND", "31", "16"), "SUMMARY:Moved");
        const cancelled = component(stamp("RECURRENCE-ID", "30", "09"), stamp("DTSTART", "30", "09"), stamp("DTEND", "31", "10"), "SUMMARY:Cancelled", "STATUS:CANCELLED");
        data = ["BEGIN:VCALENDAR", "VERSION:2.0", master, ...(scenario === "no-children" ? [] : [child, cancelled]), "END:VCALENDAR", ""].join("\r\n");
        if (scenario === "meeting") data = data.replace("SUMMARY:Master", "SUMMARY:Master\r\nORGANIZER:mailto:owner@example.test\r\nATTENDEE:mailto:guest@example.test");
        etag = '"before"'; mode = "ok"; puts = 0; onPut = undefined;
        const persist = () => replaceExternalEventResource("caldav", owner, calendar.id, collection, resource, normalizeCaldavResource({ url: resource, etag, data }).map(event => ({ externalId: event.externalId, etag, icalUid: "family", values: { title: event.title, start: event.start, end: event.end, color: "#7A8BA3", isAllDay: event.isAllDay, description: event.description, location: event.location, organizer: event.organizer ?? "", recurrence: event.recurrence, url: event.url }, time: { timeModel: event.timeModel!, externalSeriesID: event.externalSeriesID, originalStart: event.originalStart, isCanceled: event.isCanceled } })));
        await persist();
        const rows = () => db.select().from(events).where(eq(events.creatorID, owner)).orderBy(events.id);
        const maps = () => db.select().from(externalEvents).where(eq(externalEvents.calendarID, calendar.id)).orderBy(externalEvents.id);
        const outbox = () => db.select().from(eventOutbox).where(eq(eventOutbox.userID, owner));
        const original = await rows(), mappings = await maps();
        const root = original.find(event => !event.seriesID)!;
        if (scenario.startsWith("series-time-")) {
          const time = scenario.endsWith("all-day") ? { kind: "all-day", startDate: "2026-03-29", endDate: "2026-03-30" } : { kind: scenario.endsWith("floating") ? "floating" : "zoned", ...(scenario.endsWith("floating") ? {} : { timeZone: "Europe/Prague" }), startLocal: "2026-03-29T09:00:00.000", endLocal: "2026-03-30T10:00:00.000" };
          const request = { operationID: randomUUID(), scope: "series", action: "update", expectedRevision: root.revision, patch: {}, time };
          const candidate = await applyLocalEventScope(root.id, owner, request, { prepareProvider: true });
          if (candidate.status !== "caldav_required") throw new Error("Missing series time context");
          const prepared = await prepareCaldavSeries(candidate.context, request);
          const plan = planEventScope(candidate.context.master, candidate.context.children, request);
          if (scenario.endsWith("tombstone")) {
            const next = plan.updates.find(item => item.seriesID)!;
            await db.insert(externalEventTombstones).values({ externalCalendarLinkID: prepared.context.link.id, externalEventID: resource + "#musubi-original=" + encodeURIComponent(JSON.stringify(next.originalStart)) });
            await assert.rejects(() => applyLocalEventScope(root.id, owner, request, { caldav: prepared }));
            assert.deepEqual(await rows(), original); assert.deepEqual(await maps(), mappings); assert.equal((await outbox()).length, 0); continue;
          }
          assert.equal((await applyLocalEventScope(root.id, owner, request, { caldav: prepared })).status, "saved");
          const savedRows = await rows(), savedMaps = await maps();
          assert.equal(savedRows.length, original.length);
          for (const previous of original.filter(item => item.seriesID)) {
            const current = savedRows.find(item => item.id === previous.id)!;
            assert.deepEqual(current.timeModel, previous.timeModel); assert.equal(current.title, previous.title); assert.equal(current.isCanceled, previous.isCanceled);
            assert.deepEqual(current.originalStart, plan.updates.find(item => item.id === current.id)!.originalStart);
            assert.equal(current.revision, previous.revision + 1);
            const mapping = savedMaps.find(item => item.eventID === current.id)!;
            assert.deepEqual(mapping.originalStart, current.originalStart); assert.equal(mapping.id, mappings.find(item => item.eventID === current.id)!.id);
            assert.ok(mapping.externalEventID.endsWith(encodeURIComponent(JSON.stringify(current.originalStart))));
          }
          assert.ok(savedMaps.every(item => item.etag === '"before"' && !item.externalEventID.includes("musubi-pending")));
          await assert.rejects(persist); assert.deepEqual(await rows(), savedRows); assert.deepEqual(await maps(), savedMaps);
          const [operation] = await outbox(); assert.equal((await outbox()).length, 1);
          mode = scenario.endsWith("lost") ? "lost" : scenario.endsWith("race") ? "race" : "ok";
          let result = await deliverEventOutbox(operation.id, () => caldavAdapter);
          if (mode === "lost") {
            assert.equal(result?.status, "unconfirmed"); assert.deepEqual(await maps(), savedMaps); mode = "ok";
            await db.update(eventOutbox).set({ nextAttemptAt: new Date(0) }).where(eq(eventOutbox.id, operation.id));
            result = await deliverEventOutbox(operation.id, () => caldavAdapter);
          }
          assert.equal(puts, 1);
          if (scenario.endsWith("race")) {
            assert.equal(result?.status, "conflict"); assert.deepEqual(await maps(), savedMaps);
            await assert.rejects(() => prepareEventDeliveryResolution(owner, root.id, operation.id, () => caldavAdapter), (error: any) => error.code === "delivery-resolution-unavailable");
          } else {
            assert.equal(result?.status, "completed", JSON.stringify(result?.errorCode));
            assert.ok((await maps()).every(item => item.etag === '"after"'));
            await persist(); assert.deepEqual(await rows(), savedRows); assert.equal((await maps()).length, mappings.length);
            assert.equal((await applyLocalEventScope(root.id, owner, request, { prepareProvider: true })).status, "replayed");
          }
          continue;
        }
        if (scenario.startsWith("generated-")) {
          const cancellation = scenario.includes("cancel");
          const generatedTime = scenario.startsWith("generated-time-") ? scenario.endsWith("all-day") ? { kind: "all-day", startDate: "2026-04-02", endDate: "2026-04-03" } : { kind: scenario.endsWith("floating") ? "floating" : "zoned", ...(scenario.endsWith("floating") ? {} : { timeZone: "Europe/Prague" }), startLocal: "2026-04-02T12:00:00.000", endLocal: "2026-04-02T13:00:00.000" } : undefined;
          const originalStart = scenario.endsWith("all-day") ? { kind: "date", value: "2026-03-31" } : scenario.endsWith("floating") ? { kind: "floating", value: "2026-03-31T09:00:00.000" } : { kind: "instant", value: "2026-03-31T07:00:00.000Z" };
          const generatedRequest = { operationID: randomUUID(), scope: "occurrence", ...(generatedTime ? { time: generatedTime } : {}), originalStart, expectedOccurrenceRevision: null, expectedRevision: root.revision, ...(cancellation ? { action: "delete" } : { action: "update", patch: { title: "New definition" } }) };
          const candidate = await applyLocalEventScope(root.id, owner, generatedRequest, { prepareProvider: true });
          assert.equal(candidate.status, "caldav_required"); if (candidate.status !== "caldav_required") throw new Error("Missing generated context");
          const prepared = await prepareCaldavSeries(candidate.context, generatedRequest);
          const definitionID = prepared.write.newDefinition!.id;
          if (scenario === "generated-prepare-race") {
            await db.update(events).set({ revision: sql`${events.revision} + 1` }).where(eq(events.id, root.id));
            assert.equal((await applyLocalEventScope(root.id, owner, generatedRequest, { caldav: prepared })).status, "conflict");
            assert.equal((await rows()).length, original.length); assert.deepEqual(await maps(), mappings); assert.equal((await outbox()).length, 0); continue;
          }
          if (scenario === "generated-tombstone") {
            await db.insert(externalEventTombstones).values({ externalCalendarLinkID: prepared.context.link.id, externalEventID: resource + "#musubi-original=" + encodeURIComponent(JSON.stringify(originalStart)) });
            await assert.rejects(() => applyLocalEventScope(root.id, owner, generatedRequest, { caldav: prepared }));
            assert.deepEqual(await rows(), original); assert.deepEqual(await maps(), mappings); assert.equal((await outbox()).length, 0); continue;
          }
          const queued = await applyLocalEventScope(root.id, owner, generatedRequest, { caldav: prepared });
          assert.equal(queued.status, "saved");
          const savedRows = await rows(), savedMaps = await maps();
          assert.equal(savedRows.length, original.length + 1); assert.equal(savedMaps.length, mappings.length + 1);
          assert.equal(savedRows.find(item => item.id === root.id)!.revision, root.revision + 1);
          const definition = savedRows.find(item => item.id === definitionID)!;
          assert.equal(definition.revision, 1); assert.equal(definition.isCanceled, cancellation);
          assert.deepEqual(definition.originalStart, originalStart);
          if (generatedTime) assert.deepEqual(definition.timeModel, resolveEventTimeEdit(generatedTime).timeModel);
          assert.ok(savedMaps.every(item => item.etag === '"before"'));
          assert.equal(savedMaps.find(item => item.eventID === definitionID)!.externalSeriesID, resource);
          const [operation] = await outbox(); assert.equal((await outbox()).length, 1);
          assert.equal((await applyLocalEventScope(root.id, owner, generatedRequest, { prepareProvider: true })).status, "replayed");
          await assert.rejects(persist, /Complete external event resource/); assert.deepEqual(await rows(), savedRows); assert.deepEqual(await maps(), savedMaps);
          mode = scenario.endsWith("lost") ? "lost" : scenario.endsWith("race") ? "race" : "ok";
          let delivered = await deliverEventOutbox(operation.id, () => caldavAdapter);
          if (scenario.endsWith("lost")) {
            assert.equal(delivered?.status, "unconfirmed");
            await assert.rejects(persist, /Complete external event resource/); assert.deepEqual(await rows(), savedRows); assert.deepEqual(await maps(), savedMaps);
            mode = "ok";
            await db.update(eventOutbox).set({ nextAttemptAt: new Date(0) }).where(eq(eventOutbox.id, operation.id));
            delivered = await deliverEventOutbox(operation.id, () => caldavAdapter);
          }
          assert.equal(puts, 1);
          if (scenario.endsWith("race")) {
            assert.equal(delivered?.status, "conflict"); assert.deepEqual(await maps(), savedMaps);
            assert.ok(data.includes("SUMMARY:Remote child"));
          } else {
            assert.equal(delivered?.status, "completed", JSON.stringify(delivered?.errorCode));
            assert.ok(data.includes(master) && data.includes(child) && data.includes(cancelled));
            assert.ok((await maps()).every(item => item.etag === '"after"'));
            await persist(); assert.deepEqual(await rows(), savedRows);
            assert.equal((await maps()).filter(item => item.eventID === definitionID).length, 1);
            await deliverEventOutbox(operation.id, () => caldavAdapter); assert.equal(puts, 1);
          }
          continue;
        }
        const cancellation = scenario.startsWith("cancel-");
        const revival = scenario.startsWith("revive-");
        const moving = scenario.startsWith("time-");
        const time = moving ? scenario.endsWith("all-day") ? { kind: "all-day", startDate: "2026-04-02", endDate: "2026-04-03" } : { kind: scenario.endsWith("floating") ? "floating" : "zoned", ...(scenario.endsWith("floating") ? {} : { timeZone: "Europe/Prague" }), startLocal: "2026-04-02T12:00:00.000", endLocal: "2026-04-02T13:00:00.000" } : undefined;
        const occurrence = cancellation || revival || moving || scenario.startsWith("occurrence-");
        const moved = original.find(event => event.seriesID && event.isCanceled === revival)!;
        const request = { operationID: randomUUID(), scope: occurrence ? "occurrence" : "series", ...(time ? { time } : {}), ...(occurrence ? { originalStart: moved.originalStart, expectedOccurrenceRevision: moved.revision } : {}), expectedRevision: root.revision, ...(cancellation ? { action: "delete" } : { action: "update", patch: scenario === "no-op" ? {} : { title: "Renamed" } }) };
        const headers = { authorization: `Bearer ${credential.raw}`, "content-type": "application/json", [CLIENT_VERSION_HEADER]: PRODUCT_VERSION };
        const post = (body = request) => fetch(`${apiOrigin}/events/${root.id}/scope`, { method: "POST", headers, body: JSON.stringify(body) });
        if (scenario === "malformed-private") {
          data = data.replace("X-PRIVATE:Never disclose", "PRIVATE_CALDAV_MARKER_NO_COLON");
          const ICAL = (await import("ical.js")).default;
          assert.throws(() => ICAL.parse(data), /PRIVATE_CALDAV_MARKER_NO_COLON/);
          const stderrWrite = process.stderr.write;
          let logged = "";
          process.stderr.write = ((...args: any[]) => { logged += String(args[0]); return (stderrWrite as any).apply(process.stderr, args); }) as typeof process.stderr.write;
          try {
            const rejected = await post(); const body = await rejected.text();
            assert.equal(rejected.status, 409); assert.equal(JSON.parse(body).code, "provider-write-failed");
            assert.ok(!body.includes("PRIVATE_CALDAV_MARKER") && !body.includes("BEGIN:VCALENDAR"));
          } finally { process.stderr.write = stderrWrite; }
          assert.ok(logged.includes("http.request.rejected"));
          assert.ok(!logged.includes("PRIVATE_CALDAV_MARKER") && !logged.includes("BEGIN:VCALENDAR"), "Raw provider parser errors must never reach structured logs");
          assert.deepEqual(await rows(), original); assert.equal((await outbox()).length, 0); assert.equal(puts, 0);
          continue;
        }
        if (scenario === "copied") {
          const copy = await createCalendar({ creatorID: owner, name: "Other calendar", color: "red" });
          await db.insert(calendarEvents).values({ eventID: root.id, calendarID: copy.id });
        }
        if (["copied", "meeting"].includes(scenario)) {
          const rejected = await post(); assert.equal(rejected.status, 403, await rejected.text());
          assert.equal((await outbox()).length, 0); assert.equal(puts, 0); assert.equal((await getEventSnapshot(root.id))!.title, "Master");
          continue;
        }
        if (scenario === "zoned") {
          config.api.eventTimeEditsEnabled = false; assert.equal((await post()).status, 403); config.api.eventTimeEditsEnabled = true;
          for (const patch of [{ recurrence: null }, { url: "https://example.test" }]) assert.equal((await post({ ...request, patch } as any)).status, 403);
          assert.deepEqual(await rows(), original); assert.equal((await outbox()).length, 0); assert.equal(puts, 0);
        }
        if (scenario === "prepare-race") {
          const candidate = await applyLocalEventScope(root.id, owner, request, { prepareProvider: true });
          assert.equal(candidate.status, "caldav_required"); if (candidate.status !== "caldav_required") throw new Error("Missing context");
          const prepared = await prepareCaldavSeries(candidate.context, request);
          const moved = original.find(event => event.seriesID)!;
          await db.update(events).set({ title: "Concurrent local", revision: sql`${events.revision} + 1` }).where(eq(events.id, moved.id));
          assert.equal((await applyLocalEventScope(root.id, owner, request, { caldav: prepared })).status, "conflict");
          assert.equal((await outbox()).length, 0); assert.equal((await db.select().from(eventScopeOperations).where(eq(eventScopeOperations.actorID, owner))).length, 0); assert.equal((await getEventSnapshot(root.id))!.title, "Master");
          continue;
        }
        const responses = await Promise.all([post(), post()]);
        for (const response of responses) { const text = await response.text(); assert.equal(response.status, 200, text); assert.ok(!text.includes("Never disclose") && !text.includes("Private alarm") && !text.includes("BEGIN:VCALENDAR")); }
        const operations = await outbox();
        if (scenario === "no-op") { assert.equal(operations.length, 0); assert.deepEqual(await rows(), original); continue; }
        assert.equal(operations.length, 1);
        const statusResponse = await fetch(`${apiOrigin}/events/${root.id}/delivery`, { headers });
        assert.equal(statusResponse.status, 200);
        const publicStatus = await statusResponse.text();
        assert.ok(!publicStatus.includes("Never disclose") && !publicStatus.includes("Private alarm") && !publicStatus.includes("BEGIN:VCALENDAR") && !publicStatus.includes(resource));
        const operation = operations[0]!;
        assert.equal((await getEventSnapshot(root.id))!.revision, root.revision + 1);
        if (occurrence) {
          const current = (await rows()).find(event => event.id === moved.id)!;
          assert.deepEqual(current, { ...moved, ...(time ? resolveEventTimeEdit(time) : {}), ...(cancellation ? { isCanceled: true } : { title: "Renamed", ...(revival ? { isCanceled: false } : {}) }), revision: moved.revision + 1, updatedAt: current.updatedAt });
          assert.equal((await getEventSnapshot(root.id))!.title, "Master");
          assert.deepEqual((await rows()).filter(event => event.seriesID && event.id !== moved.id), original.filter(event => event.seriesID && event.id !== moved.id));
        } else assert.deepEqual((await rows()).filter(event => event.seriesID), original.filter(event => event.seriesID));
        assert.deepEqual(await maps(), mappings);
        await assert.rejects(persist, /resource could not be persisted/);
        assert.deepEqual(await maps(), mappings, "Pending pull cannot accept any component validator");
        if (["lost", "race", "occurrence-lost", "occurrence-race", "cancel-lost", "cancel-race", "revive-lost", "revive-race", "time-lost", "time-race"].includes(scenario)) mode = scenario.replace(/^(occurrence|cancel|revive|time)-/, "");
        if (scenario === "local-race") onPut = async () => { await db.update(events).set({ revision: sql`${events.revision} + 1`, title: "Newer local child" }).where(eq(events.id, original.find(event => event.seriesID)!.id)); };
        if (scenario === "mapping-race") onPut = async () => { await db.update(externalEvents).set({ etag: '"newer-map"' }).where(eq(externalEvents.id, mappings.find(map => map.eventID !== root.id)!.id)); };
        if (scenario === "lease-race") onPut = async () => { await db.update(eventOutbox).set({ leaseToken: randomUUID(), leaseUntil: new Date(Date.now() + 120000) }).where(eq(eventOutbox.id, operation.id)); };
        if (scenario === "tombstone") onPut = async () => { await db.insert(externalEventTombstones).values({ externalCalendarLinkID: operation.externalCalendarLinkID, externalEventID: resource }); };
        if (scenario.startsWith("resolve")) { data = data.replace("SUMMARY:Master", "SUMMARY:Remote master").replace("X-PRIVATE:Never disclose", "X-PRIVATE:Fresh private extension"); etag = '"remote-v2"'; }
        let result = await deliverEventOutbox(operation.id, () => caldavAdapter);
        if (scenario.startsWith("resolve")) {
          assert.equal(result?.status, "conflict");
          if (scenario === "resolve-timezone") {
            data = data.replace("VERSION:2.0", "VERSION:2.0\r\nBEGIN:VTIMEZONE\r\nTZID:Europe/Prague\r\nBEGIN:STANDARD\r\nDTSTART:20261025T030000\r\nTZOFFSETFROM:+0200\r\nTZOFFSETTO:+0300\r\nEND:STANDARD\r\nEND:VTIMEZONE");
            const refused = await fetch(`${apiOrigin}/events/${root.id}/delivery/${operation.id}/conflict`, { headers });
            assert.equal(refused.status, 409); assert.equal((await outbox()).length, 1); assert.ok((await maps()).every(item => item.etag === '"before"')); continue;
          }
          const { preview, proof } = await prepareEventDeliveryResolution(owner, root.id, operation.id, () => caldavAdapter);
          assert.equal(preview.canResolve, true); assert.equal(preview.local?.title, "Renamed"); assert.equal(preview.remote?.title, "Remote master");
          const publicPreview = await fetch(`${apiOrigin}/events/${root.id}/delivery/${operation.id}/conflict`, { headers });
          const publicText = await publicPreview.text(); assert.equal(publicPreview.status, 200); assert.ok(!publicText.includes("Fresh private extension") && !publicText.includes("BEGIN:VCALENDAR"));
          const resolveRequest = { mutationId: randomUUID(), expectedLocalRevision: preview.localRevision, expectedLatestOperationId: preview.latestOperationId, expectedRemoteExists: true, expectedRemoteEtag: preview.remoteEtag };
          const unchangedMaps = await maps();
          if (scenario === "resolve-stale") {
            etag = '"remote-v3"';
            const fresh = await prepareEventDeliveryResolution(owner, root.id, operation.id, () => caldavAdapter);
            await assert.rejects(() => commitEventDeliveryResolution(owner, fresh.proof, resolveRequest), (error: any) => error.code === "delivery-state-changed");
            assert.deepEqual(await maps(), unchangedMaps); assert.equal((await outbox()).length, 1); continue;
          }
          if (scenario === "resolve-local-race") {
            const child = (await rows()).find(item => item.seriesID)!;
            await db.update(events).set({ title: "New local child", revision: sql`${events.revision} + 1` }).where(eq(events.id, child.id));
            await assert.rejects(() => commitEventDeliveryResolution(owner, proof, resolveRequest), (error: any) => error.code === "delivery-state-changed");
            assert.deepEqual(await maps(), unchangedMaps); assert.equal((await outbox()).length, 1); continue;
          }
          if (scenario === "resolve-http") {
            const confirmed = await fetch(`${apiOrigin}/events/${root.id}/delivery/${operation.id}/resolve`, { method: "POST", headers, body: JSON.stringify(resolveRequest) });
            assert.equal(confirmed.status, 202, await confirmed.text());
            let replacement;
            for (let attempt = 0; attempt < 100; attempt++) {
              replacement = (await outbox()).find(item => item.id !== operation.id);
              if (replacement?.status === "completed") break;
              await new Promise(resolve => setTimeout(resolve, 20));
            }
            assert.equal(replacement?.status, "completed"); assert.ok((await maps()).every(item => item.etag === '"after"'));
            console.log("CalDAV scope conflict authenticated HTTP confirmation/worker: OK"); continue;
          }
          const ids = await Promise.all([commitEventDeliveryResolution(owner, proof, resolveRequest), commitEventDeliveryResolution(owner, proof, resolveRequest)]);
          assert.equal(ids[0], ids[1]); assert.equal((await outbox()).length, 2);
          if (occurrence) assert.ok(data.includes(master) && data.includes(revival ? child : cancelled), "Native master and unrelated cancellation bytes are untouched");
          assert.ok((await maps()).every(item => item.etag === '"remote-v2"'));
          assert.equal(await getEventDeliveryResolutionReplay(owner, root.id, operation.id, resolveRequest), ids[0]);
          if (scenario === "resolve-child-race") { data = data.replace("SUMMARY:Moved", "SUMMARY:New remote child"); etag = '"remote-v3"'; }
          if (scenario === "resolve-twice") {
            data = data.replace("SUMMARY:Remote master", "SUMMARY:Changed again"); etag = '"remote-v3"';
            assert.equal((await deliverEventOutbox(ids[0]!, () => caldavAdapter))?.status, "conflict");
            const again = await prepareEventDeliveryResolution(owner, root.id, ids[0]!, () => caldavAdapter);
            const second = await commitEventDeliveryResolution(owner, again.proof, { ...resolveRequest, mutationId: randomUUID(), expectedLatestOperationId: again.preview.latestOperationId, expectedRemoteEtag: again.preview.remoteEtag });
            assert.equal((await deliverEventOutbox(second, () => caldavAdapter))?.status, "completed");
            assert.ok((await outbox()).filter(item => item.id !== second).every(item => item.status === "not-needed"));
            if (occurrence) assert.ok(data.includes(master) && data.includes(revival ? child : cancelled), "Native master and unrelated cancellation bytes are untouched");
          assert.ok((await maps()).every(item => item.etag === '"after"')); console.log("CalDAV repeated conflict resolution releases exact history: OK"); continue;
          }
          const resolved = await deliverEventOutbox(ids[0]!, () => caldavAdapter);
          if (scenario === "resolve-child-race") {
            assert.equal(resolved?.status, "conflict"); assert.ok((await maps()).every(item => item.etag === '"remote-v2"')); assert.ok(data.includes("SUMMARY:New remote child")); continue;
          }
          assert.equal(resolved?.status, "completed"); assert.ok((await maps()).every(item => item.etag === '"after"'));
          assert.equal((await outbox()).find(item => item.id === operation.id)!.status, "not-needed");
          assert.ok(data.includes("SUMMARY:Renamed") && data.includes("X-PRIVATE:Fresh private extension"));
          const settled = await rows(); await persist(); assert.deepEqual(await rows(), settled);
          const next = await post({ ...request, operationID: randomUUID(), expectedRevision: root.revision + 1, patch: { title: "After resolution" } });
          assert.equal(next.status, 200, await next.text());
          continue;
        }

        if (scenario === "lost" || scenario === "occurrence-lost" || (scenario === "cancel-lost" || scenario === "revive-lost" || scenario === "time-lost")) {
          assert.equal(result?.status, "unconfirmed"); assert.deepEqual(await maps(), mappings);
          mode = "ok";
          await db.update(eventOutbox).set({ nextAttemptAt: new Date(0) }).where(eq(eventOutbox.id, operation.id));
          result = await deliverEventOutbox(operation.id, () => caldavAdapter);
        }
        assert.equal(puts, 1);
        if (["time-zoned", "time-all-day", "time-floating", "time-lost", "revive-zoned", "revive-all-day", "revive-floating", "revive-lost", "zoned", "all-day", "floating", "no-children", "lost", "occurrence-zoned", "occurrence-all-day", "occurrence-floating", "occurrence-lost", "cancel-zoned", "cancel-all-day", "cancel-floating", "cancel-lost"].includes(scenario)) {
          assert.equal(result?.status, "completed", JSON.stringify({ status: result?.status, error: result?.errorCode }));
          if (occurrence) assert.ok(data.includes(master) && data.includes(revival ? child : cancelled), "Native master and unrelated cancellation bytes are untouched");
          assert.ok((await maps()).every(map => map.etag === '"after"'));
          const confirmedRows = await rows(); await persist(); assert.deepEqual(await rows(), confirmedRows, "Accepted echo neither duplicates nor revises children");
          assert.equal((await post()).status, 200); assert.equal((await outbox()).length, 1);
          if (!cancellation) {
          const next = await post({ ...request, operationID: randomUUID(), expectedRevision: root.revision + 1, ...(occurrence ? { expectedOccurrenceRevision: moved.revision + 1 } : {}), patch: { title: "Next" } });
          assert.equal(next.status, 200, await next.text()); assert.equal((await outbox()).length, 2);
          }
        } else {
          assert.notEqual(result?.status, "completed");
          for (const map of await maps()) if (!(scenario === "mapping-race" && map.eventID !== root.id && map.etag === '"newer-map"')) assert.equal(map.etag, '"before"');
          const preview = await fetch(`${apiOrigin}/events/${root.id}/delivery/${operation.id}/conflict`, { headers });
          const text = await preview.text(); assert.equal(preview.status, 409); assert.equal(JSON.parse(text).code, ["lease-race", "local-race"].includes(scenario) ? "delivery-state-changed" : "delivery-resolution-unavailable"); assert.ok(!text.includes("Never disclose") && !text.includes("BEGIN:VCALENDAR"));
          if (scenario === "race" || scenario === "occurrence-race" || (scenario === "cancel-race" || scenario === "revive-race" || scenario === "time-race")) {
            assert.ok(data.includes("SUMMARY:Remote child"));
            await db.update(eventOutbox).set({ status: "pending", nextAttemptAt: new Date(0), uncertain: false }).where(eq(eventOutbox.id, operation.id));
            const lease = await claimEventOutbox(operation.id); assert.ok(lease);
            assert.equal(await completeEventOutbox(operation.id, lease.leaseToken!, { externalEventId: resource, icalUid: "family", etag }, { externalEventId: resource, etag: '"before"', icalUid: "family" }), undefined, "Generic single-event ACK cannot settle a family operation");
            assert.equal(await confirmCaldavSeriesOutbox(operation.id, "00000000-0000-4000-8000-000000000000", { externalEventId: resource, icalUid: "family", etag }), false);
          }
        }
      } finally { await db.delete(user).where(eq(user.id, owner)); }
      console.log(`CalDAV scoped HTTP/outbox ${scenario}: OK`);
    }
  } finally {
    config.api.eventTimeEditsEnabled = enabled;
    fixture.closeAllConnections(); api.closeAllConnections();
    await Promise.all([new Promise<void>(resolve => fixture.close(() => resolve())), new Promise<void>(resolve => api.close(() => resolve()))]);
    await db.$client.end();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
