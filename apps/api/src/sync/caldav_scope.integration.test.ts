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
  const { db, user, events, calendarMembers, calendarEvents, createCalendar, eventOutbox, externalEvents, eventScopeOperations, externalCalendars, externalEventTombstones, saveCaldavAccount, importExternalCalendar, replaceExternalEventResource, upsertExternalEvent, getEventSnapshot, replaceMemberToken, applyLocalEventScope, claimEventOutbox, completeEventOutbox, confirmCaldavSeriesOutbox, deleteExternalEvent, sweepExternalEvents, purgeDeletedEvents } = await import("@musubi/db");
  const { caldavAdapter, prepareCaldavSeriesSplit } = await import("./adapters/caldav");
  const { normalizeCaldavResource } = await import("./adapters/caldav_time");
  const { prepareCaldavSeries, prepareCaldavSeriesDelete } = await import("./caldav_scope");
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
  let missing = false, deletes = 0;
  let splitData: string | null = null, splitCreates = 0, bindAllowed = true;
  let onSplitPut: (() => Promise<void>) | undefined;
  let onDelete: (() => Promise<void>) | undefined;
  let onGet: (() => Promise<void>) | undefined;
  let onPut: (() => Promise<void>) | undefined;
  const fixture = createServer(async (req, res) => {
    if (req.method === "PROPFIND") {
      res.writeHead(207, { "content-type": "application/xml" });
      return res.end(`<d:multistatus xmlns:d="DAV:"><d:response><d:href>${req.url}</d:href><d:propstat><d:prop><d:current-user-privilege-set><d:privilege><d:write-content/></d:privilege><d:privilege><d:unbind/></d:privilege>${bindAllowed ? "<d:privilege><d:bind/></d:privilege>" : ""}</d:current-user-privilege-set></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>`);
    }
    if (req.url?.startsWith("/collection/musubi-")) {
      if (req.method === "GET") { if (splitData === null) { res.writeHead(404); return res.end(); } res.writeHead(200, { "content-type": "text/calendar", etag: '\"created\"' }); return res.end(splitData); }
      assert.equal(req.method, "PUT"); assert.equal(req.headers["if-none-match"], "*");
      splitCreates++; if (splitData !== null) { res.writeHead(412); return res.end(); }
      let body = ""; for await (const chunk of req) body += chunk; splitData = body; await onSplitPut?.();
      res.writeHead(mode === "create-lost" ? 503 : 201); return res.end();
    }
    if (req.method === "GET") { await onGet?.(); if (missing) { res.writeHead(404); return res.end(); } res.writeHead(200, { "content-type": "text/calendar", etag }); return res.end(data); }
    if (req.method === "DELETE") {
      deletes++;
      if (mode === "race") { data = data.replace("SUMMARY:Moved", "SUMMARY:Remote child"); etag = '"raced"'; }
      if (req.headers["if-match"] !== etag) { res.writeHead(412); return res.end(); }
      missing = true; await onDelete?.(); res.writeHead(mode === "lost" ? 503 : 204); return res.end();
    }
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
    for (const scenario of ["split-create-child-delete", "split-pair-tamper", "split-source-lost", "split-source-race", "split-source-grant-before", "split-source-grant-after", "split-source-local-race", "split-source-lease-race", "split-source-collision", "split-no-bind", "split-native-tamper", "split-create-lost", "split-create-grant-before", "split-create-grant-after", "split-create-local-race", "split-create-lease-race", "split-edit-source", "series-sweep", "split-sweep", "split-rollback", "split-delete-fence", "split-zoned", "split-all-day", "split-floating", "split-time", "split-recurrence", "split-race", "split-tamper", "following-sweep-echo", "delete-sweep-echo", "following-content-conflict", "following-shift-collision", "following-regenerate", "following-recancel", "following-zoned", "following-all-day", "following-floating", "following-lost", "following-race", "following-grant-before", "following-grant-after", "following-local-race", "following-lease-race", "following-cleanup", "following-restore", "following-first", "delete-recreate", "delete-cleanup", "delete-zoned", "delete-all-day", "delete-floating", "delete-lost", "delete-race", "delete-prepare-race", "delete-grant-before", "delete-grant-after", "delete-local-race", "delete-lease-race", "grant-before", "grant-after", "recurrence-zoned", "recurrence-all-day", "recurrence-floating", "recurrence-lost", "recurrence-race", "recurrence-orphan", "recurrence-bare", "recurrence-order", "series-time-zoned", "series-time-all-day", "series-time-floating", "series-time-lost", "series-time-race", "series-time-tombstone", "generated-time-zoned", "generated-time-all-day", "generated-time-floating", "generated-time-lost", "generated-time-race", "time-zoned", "time-all-day", "time-floating", "time-lost", "time-race", "revive-zoned", "revive-all-day", "revive-floating", "revive-lost", "revive-race", "generated-zoned", "generated-all-day", "generated-floating", "generated-cancel-zoned", "generated-cancel-all-day", "generated-cancel-floating", "generated-lost", "generated-race", "generated-prepare-race", "generated-tombstone", "cancel-zoned", "cancel-all-day", "cancel-floating", "cancel-lost", "cancel-race", "occurrence-zoned", "occurrence-all-day", "occurrence-floating", "occurrence-lost", "occurrence-race", "zoned", "all-day", "floating", "no-children", "malformed-private", "meeting", "copied", "lost", "race", "local-race", "mapping-race", "lease-race", "tombstone", "prepare-race", "no-op", "resolve", "resolve-all-day", "resolve-floating", "resolve-delete-observation", "resolve-twice", "resolve-http", "resolve-timezone", "resolve-stale", "resolve-local-race", "resolve-child-race"]) {
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
        etag = '"before"'; mode = "ok"; puts = 0; splitData = null; splitCreates = 0; bindAllowed = true; onSplitPut = undefined; missing = false; deletes = 0; onDelete = undefined; onPut = undefined; onGet = undefined;
        const persist = () => replaceExternalEventResource("caldav", owner, calendar.id, collection, resource, normalizeCaldavResource({ url: resource, etag, data }).map(event => ({ externalId: event.externalId, etag, icalUid: "family", values: { title: event.title, start: event.start, end: event.end, color: "#7A8BA3", isAllDay: event.isAllDay, description: event.description, location: event.location, organizer: event.organizer ?? "", recurrence: event.recurrence, url: event.url }, time: { timeModel: event.timeModel!, externalSeriesID: event.externalSeriesID, originalStart: event.originalStart, isCanceled: event.isCanceled } })));
        await persist();
        const rows = () => db.select().from(events).where(eq(events.creatorID, owner)).orderBy(events.id);
        const maps = () => db.select().from(externalEvents).where(eq(externalEvents.calendarID, calendar.id)).orderBy(externalEvents.id);
        const outbox = () => db.select().from(eventOutbox).where(eq(eventOutbox.userID, owner));
        const original = await rows(), mappings = await maps();
        const root = original.find(event => !event.seriesID)!;
        if (scenario === "series-sweep") {
          const request = { operationID: randomUUID(), scope: "series", action: "update", patch: { title: "Pending series" }, expectedRevision: root.revision };
          const candidate = await applyLocalEventScope(root.id, owner, request, { prepareProvider: true });
          if (candidate.status !== "caldav_required") throw new Error("Missing series context");
          const prepared = await prepareCaldavSeries(candidate.context, request);
          await applyLocalEventScope(root.id, owner, request, { caldav: prepared });
          const saved = await rows();
          const child = mappings.find(item => item.eventID !== root.id)!;
          assert.equal(await deleteExternalEvent("caldav", calendar.id, child.externalEventID), false);
          assert.equal(await sweepExternalEvents("caldav", calendar.id, []), 0);
          assert.deepEqual(await rows(), saved); assert.deepEqual(await maps(), mappings);
          assert.equal((await outbox())[0].status, "conflict"); continue;
        }
        if (scenario.startsWith("split-")) {
          // Public following update stays closed until its specialized worker
          // exists. Obtain the existing read-only complete-family context.
          const probe = { operationID: randomUUID(), scope: "series", action: "update", patch: { title: "Probe" }, expectedRevision: root.revision };
          const candidate = await applyLocalEventScope(root.id, owner, probe, { prepareProvider: true });
          if (candidate.status !== "caldav_required") throw new Error("Missing split context");
          const cut = original.find(item => item.isCanceled)!;
          const request = { operationID: randomUUID(), scope: "following" as const, action: "update" as const, expectedRevision: root.revision, originalStart: cut.originalStart!, expectedOccurrenceRevision: cut.revision, patch: { title: "New portion", ...(scenario === "split-recurrence" ? { recurrence: "FREQ=DAILY;COUNT=3;INTERVAL=1" } : {}) }, ...(scenario === "split-time" ? { time: { kind: "zoned" as const, timeZone: "Europe/Prague", startLocal: "2026-03-30T11:00:00.000", endLocal: "2026-03-31T12:00:00.000" } } : {}) };
          await assert.rejects(() => applyLocalEventScope(root.id, owner, request, { prepareProvider: true }));
          const baseline = { master: candidate.context.master, children: candidate.context.children, ref: { externalEventId: resource, etag, icalUid: "family" } };
          const evidence = await caldavAdapter.readCaldavSeries!(owner, account.id, collection, baseline);
          const split = prepareCaldavSeriesSplit(evidence, baseline, request);
          const prepared = JSON.parse(JSON.stringify({ context: candidate.context, split }));
          const originalData = data;
          if (scenario === "split-native-tamper") prepared.split.creation.data = prepared.split.creation.data.replace("SUMMARY:New portion", "SUMMARY:Unplanned native title");
          if (scenario === "split-rollback") {
            const unrelated = randomUUID();
            await db.insert(eventOutbox).values({ id: unrelated, actorID: owner, mutationID: request.operationID, position: 1, eventID: randomUUID(), revision: 1, calendarID: calendar.id, externalCalendarLinkID: candidate.context.link.id, provider: "caldav", userID: owner, accountID: account.id, externalCalendarID: collection, action: "create", payload: { event: candidate.context.master } });
            await assert.rejects(() => applyLocalEventScope(root.id, owner, request, { caldavSplit: prepared }));
            assert.deepEqual(await rows(), original); assert.deepEqual(await maps(), mappings); assert.deepEqual((await outbox()).map(item => item.id), [unrelated]);
            assert.equal((await db.select().from(eventScopeOperations).where(eq(eventScopeOperations.actorID, owner))).length, 0); continue;
          }
          if (scenario === "split-race") {
            await db.update(events).set({ revision: sql`${events.revision} + 1` }).where(eq(events.id, cut.id));
            const before = await rows();
            await assert.rejects(() => applyLocalEventScope(root.id, owner, request, { caldavSplit: prepared }));
            assert.deepEqual(await rows(), before); assert.deepEqual(await maps(), mappings); assert.equal((await outbox()).length, 0); continue;
          }
          if (scenario === "split-tamper") {
            for (const mutate of [
              (value: typeof prepared) => { value.split.creation.children[0].title = "Lost cancellation content"; },
              (value: typeof prepared) => { value.split.creation.ref.etag = '"invented"'; },
              (value: typeof prepared) => { value.split.source.followingDelete.originalStart = baseline.children.find(child => !child.isCanceled)!.originalStart; },
              (value: typeof prepared) => { value.split.creation.master.id = root.id; },
              (value: typeof prepared) => { value.context.link.accountID = "different-account"; },
            ]) {
              const invalid = structuredClone(prepared); mutate(invalid);
              await assert.rejects(() => applyLocalEventScope(root.id, owner, request, { caldavSplit: invalid }));
              assert.deepEqual(await rows(), original); assert.deepEqual(await maps(), mappings); assert.equal((await outbox()).length, 0);
            }
            continue;
          }
          const [first, second] = await Promise.all([applyLocalEventScope(root.id, owner, request, { caldavSplit: prepared }), applyLocalEventScope(root.id, owner, request, { caldavSplit: prepared })]);
          assert.deepEqual([first.status, second.status].sort(), ["replayed", "saved"]);
          let saved = await rows(); assert.equal(saved.length, original.length + 1);
          const moved = saved.find(item => item.id === cut.id)!;
          assert.equal(moved.seriesID, split.creation.master.id); assert.equal(moved.revision, cut.revision + 1); assert.equal(moved.isCanceled, true); assert.equal(moved.title, cut.title); assert.deepEqual(moved.start, cut.start);
          const retained = original.find(item => item.seriesID && !item.isCanceled)!;
          assert.deepEqual(saved.find(item => item.id === retained.id), retained);
          assert.deepEqual(await maps(), mappings);
          const queued = (await outbox()).sort((a, b) => a.position - b.position); assert.equal(queued.length, 2);
          assert.equal(queued[0].action, "update"); assert.equal(queued[1].action, "create"); assert.equal(queued[1].predecessorID, queued[0].id); assert.equal(queued[1].id, split.creation.master.id);
          assert.deepEqual(queued[0].payload.caldavSplit, queued[1].payload.caldavSplit);
          assert.equal(await claimEventOutbox(queued[1].id), undefined);
          await assert.rejects(persist);
          const newObservations = normalizeCaldavResource({ url: split.creation.ref.externalEventId, data: split.creation.data, etag: '"created"' }).map(event => ({ externalId: event.externalId, etag: '"created"', icalUid: split.creation.ref.icalUid!, values: { title: event.title, start: event.start, end: event.end, color: "#7A8BA3", isAllDay: event.isAllDay, recurrence: event.recurrence, description: event.description, location: event.location, organizer: event.organizer ?? "", url: event.url }, time: { timeModel: event.timeModel!, externalSeriesID: event.externalSeriesID, originalStart: event.originalStart, isCanceled: event.isCanceled } }));
          await assert.rejects(() => replaceExternalEventResource("caldav", owner, calendar.id, collection, split.creation.ref.externalEventId, newObservations));
          const observedRoot = newObservations.find(item => !item.time.externalSeriesID)!;
          await assert.rejects(() => upsertExternalEvent("caldav", owner, calendar.id, collection, observedRoot.externalId, observedRoot.values, observedRoot.etag, observedRoot.icalUid, undefined, observedRoot.time));
          assert.deepEqual(await rows(), saved); assert.deepEqual(await maps(), mappings);
          if (scenario === "split-sweep") {
            const movedMapping = mappings.find(item => item.eventID === cut.id)!;
            assert.equal(await deleteExternalEvent("caldav", calendar.id, movedMapping.externalEventID), false);
            assert.equal(await sweepExternalEvents("caldav", calendar.id, []), 0);
            assert.deepEqual(await rows(), saved); assert.deepEqual(await maps(), mappings);
            assert.equal((await outbox()).find(item => item.id === queued[0].id)!.status, "conflict");
            assert.equal(await claimEventOutbox(queued[1].id), undefined); continue;
          }
          if (scenario === "split-delete-fence") {
            await deleteExternalEvent("caldav", calendar.id, split.creation.ref.externalEventId);
            assert.equal((await outbox()).find(item => item.id === queued[1].id)!.status, "conflict");
            assert.equal((await db.select().from(externalEventTombstones).where(eq(externalEventTombstones.externalCalendarLinkID, candidate.context.link.id))).length, 1);
            assert.deepEqual(await rows(), saved); assert.deepEqual(await maps(), mappings); continue;
          }
          const lease = await claimEventOutbox(queued[0].id); assert.ok(lease);
          assert.equal(await completeEventOutbox(lease.id, lease.leaseToken!, split.source.baseline.ref, split.source.baseline.ref), undefined);
          await db.update(eventOutbox).set({ status: "pending", leaseToken: null, leaseUntil: null }).where(eq(eventOutbox.id, lease.id));
          const revoke = () => db.update(calendarMembers).set({ role: "viewer" }).where(and(eq(calendarMembers.calendarID, calendar.id), eq(calendarMembers.userID, owner))).then(() => {});
          if (scenario === "split-source-lost") mode = "lost";
          if (scenario === "split-source-race") mode = "race";
          if (scenario === "split-source-grant-before") onGet = revoke;
          if (scenario === "split-source-grant-after") onPut = revoke;
          if (scenario === "split-source-local-race") onPut = () => db.update(events).set({ title: "Newer local child", revision: sql`${events.revision} + 1` }).where(eq(events.id, moved.id)).then(() => {});
          if (scenario === "split-source-lease-race") onPut = () => db.update(eventOutbox).set({ leaseUntil: new Date(0) }).where(eq(eventOutbox.id, lease.id)).then(() => {});
          if (scenario === "split-source-collision") splitData = split.creation.data.replace("SUMMARY:New portion", "SUMMARY:Unrelated remote resource");
          if (scenario === "split-no-bind") bindAllowed = false;
          if (scenario === "split-pair-tamper") await db.update(eventOutbox).set({ externalEventID: collection + "wrong-destination.ics" }).where(eq(eventOutbox.id, queued[1].id));
          let sourceResult = await deliverEventOutbox(lease.id, () => caldavAdapter);
          if (scenario === "split-source-lost") {
            assert.equal(sourceResult?.status, "unconfirmed"); assert.deepEqual(await maps(), mappings); assert.equal(splitCreates, 0);
            mode = "ok"; await db.update(eventOutbox).set({ nextAttemptAt: new Date(0) }).where(eq(eventOutbox.id, lease.id));
            sourceResult = await deliverEventOutbox(lease.id, () => caldavAdapter);
          }
          if (["split-pair-tamper", "split-source-race", "split-source-grant-before", "split-source-grant-after", "split-source-local-race", "split-source-lease-race", "split-source-collision", "split-no-bind", "split-native-tamper"].includes(scenario)) {
            assert.notEqual(sourceResult?.status, "completed"); assert.deepEqual(await maps(), mappings); assert.equal(splitCreates, 0);
            assert.equal(puts, ["split-pair-tamper", "split-source-grant-before", "split-source-collision", "split-no-bind", "split-native-tamper"].includes(scenario) ? 0 : 1);
            assert.equal(await claimEventOutbox(queued[1].id), undefined); continue;
          }
          assert.equal(sourceResult?.status, "completed", JSON.stringify(sourceResult)); assert.equal(puts, 1); assert.equal(splitCreates, 0); assert.equal(deletes, 0);
          const sourceMaps = await maps(); assert.equal(sourceMaps.length, mappings.length - split.creation.children.length);
          assert.ok(sourceMaps.every(item => item.etag === '\"after\"'));
          // Delayed removals from the old resource cannot poison either address.
          for (const mapping of mappings.filter(item => split.creation.children.some(child => child.id === item.eventID))) assert.equal(await deleteExternalEvent("caldav", calendar.id, mapping.externalEventID), false);
          assert.equal((await db.select().from(externalEventTombstones).where(eq(externalEventTombstones.externalCalendarLinkID, candidate.context.link.id))).length, 0);
          if (scenario === "split-edit-source") {
            const edit = { operationID: randomUUID(), scope: "series", action: "update", expectedRevision: (await getEventSnapshot(root.id))!.revision, patch: { title: "Independent old portion" } };
            const context = await applyLocalEventScope(root.id, owner, edit, { prepareProvider: true });
            if (context.status !== "caldav_required") throw new Error("Old portion remained blocked");
            const native = await prepareCaldavSeries(context.context, edit);
            await applyLocalEventScope(root.id, owner, edit, { caldav: native });
            const operation = (await outbox()).find(item => item.payload.caldavSeries)!;
            assert.equal((await deliverEventOutbox(operation.id, () => caldavAdapter))?.status, "completed"); saved = await rows();
          }
          if (scenario === "split-create-lost") mode = "create-lost";
          if (scenario === "split-create-grant-before") await revoke();
          if (scenario === "split-create-grant-after") onSplitPut = revoke;
          if (scenario === "split-create-child-delete") onSplitPut = async () => { await deleteExternalEvent("caldav", calendar.id, split.creation.ref.externalEventId + "#musubi-original=" + encodeURIComponent(JSON.stringify(split.creation.children[0].originalStart))); };
          if (scenario === "split-create-local-race") onSplitPut = () => db.update(events).set({ title: "Newer local head", revision: sql`${events.revision} + 1` }).where(eq(events.id, split.creation.master.id)).then(() => {});
          if (scenario === "split-create-lease-race") onSplitPut = () => db.update(eventOutbox).set({ leaseUntil: new Date(0) }).where(eq(eventOutbox.id, queued[1].id)).then(() => {});
          let creationResult = await deliverEventOutbox(queued[1].id, () => caldavAdapter);
          if (scenario === "split-create-lost") {
            assert.equal(creationResult?.status, "unconfirmed"); assert.deepEqual(await maps(), sourceMaps);
            mode = "ok"; await db.update(eventOutbox).set({ nextAttemptAt: new Date(0) }).where(eq(eventOutbox.id, queued[1].id));
            creationResult = await deliverEventOutbox(queued[1].id, () => caldavAdapter);
          }
          if (["split-create-child-delete", "split-create-grant-before", "split-create-grant-after", "split-create-local-race", "split-create-lease-race"].includes(scenario)) {
            assert.notEqual(creationResult?.status, "completed"); assert.deepEqual(await maps(), sourceMaps); assert.equal(splitCreates, scenario === "split-create-grant-before" ? 0 : 1); continue;
          }
          assert.equal(creationResult?.status, "completed", JSON.stringify(creationResult)); assert.equal(puts, scenario === "split-edit-source" ? 2 : 1); assert.equal(splitCreates, 1);
          const accepted = await maps(); assert.equal(accepted.length, mappings.length + 1);
          assert.equal(accepted.find(item => item.eventID === moved.id)!.externalSeriesID, split.creation.ref.externalEventId);
          assert.equal(accepted.find(item => item.eventID === moved.id)!.etag, '\"created\"');
          assert.deepEqual(await rows(), saved);
          const acceptedData = data, acceptedTag = etag;
          data = originalData; etag = '\"before\"'; assert.equal(await persist(), false); assert.deepEqual(await rows(), saved); assert.deepEqual(await maps(), accepted);
          data = acceptedData; etag = acceptedTag;
          await persist();
          await replaceExternalEventResource("caldav", owner, calendar.id, collection, split.creation.ref.externalEventId, newObservations);
          assert.deepEqual(await rows(), saved); assert.deepEqual(await maps(), accepted);
          await assert.rejects(() => prepareEventDeliveryResolution(owner, root.id, lease.id, () => caldavAdapter));
          continue;
        }
        if (scenario.startsWith("following-")) {
          const cut = original.find(item => item.isCanceled)!;
          const originalStart = scenario === "following-first" ? { kind: "instant", value: "2026-03-28T08:00:00.000Z" } : cut.originalStart;
          const request = { operationID: randomUUID(), scope: "following", action: "delete", expectedRevision: root.revision, originalStart, expectedOccurrenceRevision: scenario === "following-first" ? null : cut.revision };
          const candidate = await applyLocalEventScope(root.id, owner, request, { prepareProvider: true });
          if (candidate.status !== "caldav_required") throw new Error("Missing following scope context");
          const plan = planEventScope(candidate.context.master, candidate.context.children, request);
          const fullDelete = scenario === "following-first";
          assert.equal(candidate.deleteResource, fullDelete);
          const beforeData = data;
          const response = await fetch(`${apiOrigin}/events/${root.id}/scope`, { method: "POST", headers: { authorization: `Bearer ${credential.raw}`, "content-type": "application/json", [CLIENT_VERSION_HEADER]: PRODUCT_VERSION }, body: JSON.stringify(request) });
          assert.equal(response.status, 200, await response.text());
          if (scenario === "following-cleanup") {
            for (const id of plan.deletes) await db.update(events).set({ deletedAt: new Date("2020-01-01") }).where(eq(events.id, id));
            await purgeDeletedEvents(new Date("2021-01-01"));
          }
          const savedRows = await rows(); assert.equal(savedRows.length, original.length);
          for (const current of savedRows) {
            const previous = original.find(item => item.id === current.id)!;
            assert.equal(!!current.deletedAt, plan.deletes.includes(current.id));
            assert.equal(current.revision, previous.revision + (current.id === root.id || plan.deletes.includes(current.id) ? 1 : 0));
            if (current.id !== root.id && !plan.deletes.includes(current.id)) assert.deepEqual(current, previous);
          }
          assert.deepEqual(await maps(), mappings); await assert.rejects(persist);
          const [operation] = await outbox(); assert.equal((await outbox()).length, 1); assert.equal(operation.action, fullDelete ? "delete" : "update");
          assert.equal((await applyLocalEventScope(root.id, owner, request, { prepareProvider: true })).status, "replayed");
          const revoke = () => db.update(calendarMembers).set({ role: "viewer" }).where(and(eq(calendarMembers.calendarID, calendar.id), eq(calendarMembers.userID, owner))).then(() => {});
          if (scenario === "following-grant-before") onGet = revoke;
          if (scenario === "following-grant-after") onPut = revoke;
          if (scenario === "following-sweep-echo") onPut = async () => { for (const mapping of mappings.filter(item => plan.deletes.includes(item.eventID))) assert.equal(await deleteExternalEvent("caldav", calendar.id, mapping.externalEventID), false); };
          if (scenario === "following-local-race") onPut = () => db.update(events).set({ revision: sql`${events.revision} + 1` }).where(eq(events.id, cut.id)).then(() => {});
          if (scenario === "following-lease-race") onPut = () => db.update(eventOutbox).set({ leaseUntil: new Date(0) }).where(eq(eventOutbox.id, operation.id)).then(() => {});
          mode = scenario === "following-lost" ? "lost" : scenario === "following-race" ? "race" : "ok";
          let delivered = await deliverEventOutbox(operation.id, () => caldavAdapter);
          if (scenario === "following-lost") {
            assert.equal(delivered?.status, "unconfirmed"); assert.deepEqual(await maps(), mappings);
            mode = "ok"; await db.update(eventOutbox).set({ nextAttemptAt: new Date(0) }).where(eq(eventOutbox.id, operation.id));
            delivered = await deliverEventOutbox(operation.id, () => caldavAdapter);
          }
          assert.equal(puts, fullDelete || scenario === "following-grant-before" ? 0 : 1); assert.equal(deletes, fullDelete ? 1 : 0);
          if (["following-race", "following-grant-before", "following-grant-after", "following-local-race", "following-lease-race"].includes(scenario)) {
            assert.notEqual(delivered?.status, "completed"); assert.deepEqual(await maps(), mappings);
            await assert.rejects(() => prepareEventDeliveryResolution(owner, root.id, operation.id, () => caldavAdapter)); continue;
          }
          assert.equal(delivered?.status, "completed", JSON.stringify(delivered));
          const acceptedMaps = await maps(); assert.equal(acceptedMaps.length, mappings.length - plan.deletes.length);
          assert.ok(acceptedMaps.every(item => item.etag === '"after"'));
          const acceptedData = data, acceptedETag = etag;
          data = beforeData; etag = '"before"'; assert.equal(await persist(), false); assert.deepEqual(await rows(), savedRows);
          data = acceptedData; etag = acceptedETag;
          for (const mapping of mappings.filter(item => plan.deletes.includes(item.eventID))) await deleteExternalEvent("caldav", calendar.id, mapping.externalEventID);
          assert.equal((await db.select().from(externalEventTombstones).where(eq(externalEventTombstones.externalCalendarLinkID, candidate.context.link.id))).length, 0);
          if (fullDelete) continue;
          await persist(); assert.deepEqual(await rows(), savedRows);
          if (scenario === "following-restore") {
            data = beforeData; etag = '"restored"'; await persist();
            const restored = (await rows()).find(item => item.id === cut.id)!;
            assert.equal(restored.deletedAt, null); assert.equal(restored.revision, cut.revision + 2); assert.equal((await rows()).length, original.length);
            assert.equal((await maps()).find(item => item.eventID === cut.id)!.externalEventID, mappings.find(item => item.eventID === cut.id)!.externalEventID);
          }
          if (scenario === "following-shift-collision") {
            const shift = { operationID: randomUUID(), scope: "series", action: "update", expectedRevision: (await getEventSnapshot(root.id))!.revision, patch: {}, time: { kind: "zoned", timeZone: "Europe/Prague", startLocal: "2026-03-29T09:00:00.000", endLocal: "2026-03-30T10:00:00.000" } };
            const beforeRows = await rows(), beforeMaps = await maps(), beforeOutbox = await outbox();
            await assert.rejects(() => applyLocalEventScope(root.id, owner, shift, { prepareProvider: true }), /retired occurrence identity/);
            assert.deepEqual(await rows(), beforeRows); assert.deepEqual(await maps(), beforeMaps); assert.deepEqual(await outbox(), beforeOutbox);
          }
          const current = (await getEventSnapshot(root.id))!;
          const edit = { operationID: randomUUID(), scope: "series", action: "update", expectedRevision: current.revision, patch: { title: "Retained family remains editable", ...(["following-regenerate", "following-recancel"].includes(scenario) ? { recurrence: "RRULE:FREQ=DAILY;COUNT=4" } : {}) } };
          const next = await applyLocalEventScope(root.id, owner, edit, { prepareProvider: true });
          if (next.status !== "caldav_required") throw new Error("Historical tombstone blocked the remaining family");
          const prepared = await prepareCaldavSeries(next.context, edit);
          assert.equal((await applyLocalEventScope(root.id, owner, edit, { caldav: prepared })).status, "saved");
          const nextOperation = (await outbox()).find(item => item.mutationID === edit.operationID)!;
          if (scenario === "following-content-conflict") {
            data = data.replace("SUMMARY:Master", "SUMMARY:Remote master"); etag = '"remote-content"';
            assert.equal((await deliverEventOutbox(nextOperation.id, () => caldavAdapter))?.status, "conflict");
            const { preview, proof } = await prepareEventDeliveryResolution(owner, root.id, nextOperation.id, () => caldavAdapter);
            assert.equal(preview.canResolve, true);
            const replacement = await commitEventDeliveryResolution(owner, proof, { mutationId: randomUUID(), expectedLocalRevision: preview.localRevision, expectedLatestOperationId: preview.latestOperationId, expectedRemoteExists: true, expectedRemoteEtag: preview.remoteEtag });
            assert.equal((await deliverEventOutbox(replacement!, () => caldavAdapter))?.status, "completed");
          } else assert.equal((await deliverEventOutbox(nextOperation.id, () => caldavAdapter))?.status, "completed");
          if (["following-regenerate", "following-recancel"].includes(scenario)) {
            const request = { operationID: randomUUID(), scope: "occurrence", expectedRevision: (await getEventSnapshot(root.id))!.revision, originalStart: cut.originalStart, expectedOccurrenceRevision: null, ...(scenario === "following-recancel" ? { action: "delete" } : { action: "update", patch: { title: "Recreated occurrence" } }) };
            const retry = await applyLocalEventScope(root.id, owner, request, { prepareProvider: true });
            if (retry.status !== "caldav_required") throw new Error("Missing regenerated scope context");
            const retryPrepared = await prepareCaldavSeries(retry.context, request);
            assert.equal(retryPrepared.write.newDefinition!.id, cut.id);
            assert.equal((await applyLocalEventScope(root.id, owner, request, { caldav: retryPrepared })).status, "saved");
            const retryOperation = (await outbox()).find(item => item.mutationID === request.operationID)!;
            assert.equal((await deliverEventOutbox(retryOperation.id, () => caldavAdapter))?.status, "completed");
            const child = (await rows()).find(item => item.id === cut.id)!;
            assert.equal(child.deletedAt, null); assert.equal(child.revision, cut.revision + 2); assert.equal(child.isCanceled, scenario === "following-recancel");
            await persist(); assert.equal((await rows()).length, original.length);
          }
          if (scenario === "following-cleanup") {
            await purgeDeletedEvents(new Date("2021-01-01")); assert.equal((await rows()).length, original.length - plan.deletes.length);
          }
          const finalRoot = (await getEventSnapshot(root.id))!;
          const remove = { operationID: randomUUID(), scope: "series", action: "delete", expectedRevision: finalRoot.revision };
          const final = await applyLocalEventScope(root.id, owner, remove, { prepareProvider: true });
          if (final.status !== "caldav_required") throw new Error("Remaining family cannot be deleted");
          const deletion = await prepareCaldavSeriesDelete(final.context, remove);
          assert.equal((await applyLocalEventScope(root.id, owner, remove, { caldavDeletion: deletion })).status, "saved");
          const finalOperation = (await outbox()).find(item => item.mutationID === remove.operationID)!;
          assert.equal((await deliverEventOutbox(finalOperation.id, () => caldavAdapter))?.status, "completed"); assert.deepEqual(await maps(), []);
          continue;
        }
        if (scenario.startsWith("delete-")) {
          const request = { operationID: randomUUID(), scope: "series", action: "delete", expectedRevision: root.revision };
          const candidate = await applyLocalEventScope(root.id, owner, request, { prepareProvider: true });
          if (candidate.status !== "caldav_required") throw new Error("Missing series deletion context");
          const prepared = await prepareCaldavSeriesDelete(candidate.context, request);
          if (scenario === "delete-prepare-race") {
            await db.update(events).set({ revision: sql`${events.revision} + 1` }).where(eq(events.id, original.find(item => item.seriesID)!.id));
            assert.equal((await applyLocalEventScope(root.id, owner, request, { caldavDeletion: prepared })).status, "conflict");
            assert.ok((await rows()).every(item => !item.deletedAt)); assert.deepEqual(await maps(), mappings); assert.equal((await outbox()).length, 0); continue;
          }
          if (scenario === "delete-zoned") {
            const response = await fetch(`${apiOrigin}/events/${root.id}/scope`, { method: "POST", headers: { authorization: `Bearer ${credential.raw}`, "content-type": "application/json", [CLIENT_VERSION_HEADER]: PRODUCT_VERSION }, body: JSON.stringify(request) });
            assert.equal(response.status, 200, await response.text());
          } else assert.equal((await applyLocalEventScope(root.id, owner, request, { caldavDeletion: prepared })).status, "saved");
          if (scenario === "delete-cleanup") {
            for (const item of original) await db.update(events).set({ deletedAt: new Date("2020-01-01") }).where(eq(events.id, item.id));
            await purgeDeletedEvents(new Date("2021-01-01"));
          }
          const savedRows = await rows();
          assert.equal(savedRows.length, original.length);
          assert.ok(savedRows.every(item => item.deletedAt && item.revision === original.find(old => old.id === item.id)!.revision + 1));
          assert.deepEqual(await maps(), mappings);
          const [operation] = await outbox(); assert.equal((await outbox()).length, 1); assert.equal(operation.action, "delete");
          assert.equal((await applyLocalEventScope(root.id, owner, request, { prepareProvider: true })).status, "replayed");
          await assert.rejects(persist); assert.deepEqual(await rows(), savedRows);
          const claim = await claimEventOutbox(operation.id); assert.ok(claim);
          assert.equal(await completeEventOutbox(operation.id, claim.leaseToken!, prepared.deletion.baseline.ref, prepared.deletion.baseline.ref), undefined);
          await db.update(eventOutbox).set({ status: "pending", leaseToken: null, leaseUntil: null, nextAttemptAt: new Date(0) }).where(eq(eventOutbox.id, operation.id));
          const revoke = () => db.update(calendarMembers).set({ role: "viewer" }).where(and(eq(calendarMembers.calendarID, calendar.id), eq(calendarMembers.userID, owner))).then(() => {});
          if (scenario === "delete-grant-before") onGet = revoke;
          if (scenario === "delete-grant-after") onDelete = revoke;
          if (scenario === "delete-sweep-echo") onDelete = async () => { assert.equal(await sweepExternalEvents("caldav", calendar.id, []), 0); };
          if (scenario === "delete-local-race") onDelete = () => db.update(events).set({ revision: sql`${events.revision} + 1` }).where(eq(events.id, original.find(item => item.seriesID)!.id)).then(() => {});
          if (scenario === "delete-lease-race") onDelete = () => db.update(eventOutbox).set({ leaseUntil: new Date(0) }).where(eq(eventOutbox.id, operation.id)).then(() => {});
          mode = scenario === "delete-lost" ? "lost" : scenario === "delete-race" ? "race" : "ok";
          let delivered = await deliverEventOutbox(operation.id, () => caldavAdapter);
          if (scenario === "delete-lost") {
            assert.equal(delivered?.status, "unconfirmed"); assert.deepEqual(await maps(), mappings);
            await deleteExternalEvent("caldav", calendar.id, resource); assert.deepEqual(await rows(), savedRows); assert.deepEqual(await maps(), mappings);
            mode = "ok"; await db.update(eventOutbox).set({ nextAttemptAt: new Date(0) }).where(eq(eventOutbox.id, operation.id));
            delivered = await deliverEventOutbox(operation.id, () => caldavAdapter);
          }
          assert.equal(puts, 0); assert.equal(deletes, scenario === "delete-grant-before" ? 0 : 1);
          if (["delete-race", "delete-grant-before", "delete-grant-after", "delete-local-race", "delete-lease-race"].includes(scenario)) {
            assert.notEqual(delivered?.status, "completed"); assert.deepEqual(await maps(), mappings);
          } else {
            assert.equal(delivered?.status, "completed", JSON.stringify(delivered)); assert.deepEqual(await maps(), []);
            assert.equal(await persist(), false, "An old resource snapshot must not resurrect a confirmed deletion");
            assert.deepEqual(await rows(), savedRows); assert.deepEqual(await maps(), []);
            await deliverEventOutbox(operation.id, () => caldavAdapter); assert.equal(deletes, 1);
            if (scenario === "delete-recreate") {
              for (const mapping of mappings) await deleteExternalEvent("caldav", calendar.id, mapping.externalEventID);
              assert.equal((await db.select().from(externalEventTombstones).where(eq(externalEventTombstones.externalCalendarLinkID, prepared.context.link.id))).length, 0);
              missing = false; etag = '"recreated"'; assert.equal(await persist(), true);
              const recreated = (await rows()).find(item => !item.deletedAt && !item.seriesID)!; assert.notEqual(recreated.id, root.id);
              const edit = { operationID: randomUUID(), scope: "series", action: "update", expectedRevision: recreated.revision, patch: { title: "Editable recreation" } };
              const next = await applyLocalEventScope(recreated.id, owner, edit, { prepareProvider: true });
              assert.equal(next.status, "caldav_required"); if (next.status !== "caldav_required") throw new Error("Recreated family must remain editable");
              const nextPrepared = await prepareCaldavSeries(next.context, edit);
              assert.equal((await applyLocalEventScope(recreated.id, owner, edit, { caldav: nextPrepared })).status, "saved");
              const update = (await outbox()).find(item => item.mutationID === edit.operationID)!;
              assert.equal((await deliverEventOutbox(update.id, () => caldavAdapter))?.status, "completed");
            }
            if (scenario === "delete-cleanup") {
              await purgeDeletedEvents(new Date("2021-01-01")); assert.deepEqual(await rows(), []);
              assert.equal(await persist(), false); assert.deepEqual(await rows(), []); continue;
            }
            assert.equal((await applyLocalEventScope(root.id, owner, request, { prepareProvider: true })).status, "replayed");
          }
          continue;
        }
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
        const recurrenceEdit = scenario.startsWith("recurrence-");
        const cancellation = scenario.startsWith("cancel-");
        const revival = scenario.startsWith("revive-");
        const moving = scenario.startsWith("time-");
        const time = moving ? scenario.endsWith("all-day") ? { kind: "all-day", startDate: "2026-04-02", endDate: "2026-04-03" } : { kind: scenario.endsWith("floating") ? "floating" : "zoned", ...(scenario.endsWith("floating") ? {} : { timeZone: "Europe/Prague" }), startLocal: "2026-04-02T12:00:00.000", endLocal: "2026-04-02T13:00:00.000" } : undefined;
        const occurrence = cancellation || revival || moving || scenario.startsWith("occurrence-");
        const moved = original.find(event => event.seriesID && event.isCanceled === revival)!;
        const request = { operationID: randomUUID(), scope: occurrence ? "occurrence" : "series", ...(time ? { time } : {}), ...(occurrence ? { originalStart: moved.originalStart, expectedOccurrenceRevision: moved.revision } : {}), expectedRevision: root.revision, ...(cancellation ? { action: "delete" } : { action: "update", patch: scenario === "no-op" ? {} : { title: "Renamed", ...(recurrenceEdit ? { recurrence: scenario === "recurrence-bare" ? "FREQ=DAILY;COUNT=5" : scenario === "recurrence-order" ? "FREQ=DAILY;INTERVAL=1;COUNT=5" : "RRULE:FREQ=DAILY;COUNT=5" } : {}) } }) };
        const headers = { authorization: `Bearer ${credential.raw}`, "content-type": "application/json", [CLIENT_VERSION_HEADER]: PRODUCT_VERSION };
        const post = (body = request) => fetch(`${apiOrigin}/events/${root.id}/scope`, { method: "POST", headers, body: JSON.stringify(body) });
        if (scenario === "recurrence-orphan") {
          const rejected = await post({ ...request, patch: { recurrence: "RRULE:FREQ=DAILY;COUNT=2" } } as any);
          assert.equal(rejected.status, 400, await rejected.text()); assert.deepEqual(await rows(), original); assert.deepEqual(await maps(), mappings); assert.equal((await outbox()).length, 0); continue;
        }
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
        if (["lost", "race", "occurrence-lost", "occurrence-race", "cancel-lost", "cancel-race", "revive-lost", "revive-race", "time-lost", "time-race", "recurrence-lost", "recurrence-race"].includes(scenario)) mode = scenario.replace(/^(occurrence|cancel|revive|time|recurrence)-/, "");
        const revokeGrant = async () => { await db.update(calendarMembers).set({ role: "viewer" }).where(and(eq(calendarMembers.calendarID, calendar.id), eq(calendarMembers.userID, owner))); };
        if (scenario === "grant-before") onGet = revokeGrant;
        if (scenario === "grant-after") onPut = revokeGrant;
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
          if (scenario === "resolve-delete-observation") {
            const before = await rows();
            const child = mappings.find(item => item.eventID !== root.id)!;
            assert.equal(await deleteExternalEvent("caldav", calendar.id, child.externalEventID), false);
            const journals = await outbox();
            assert.equal(journals.find(item => item.id === operation.id)!.errorCode, "superseded-by-resolution");
            assert.equal(journals.find(item => item.id === ids[0])!.status, "conflict");
            assert.deepEqual(await rows(), before);
            const again = await prepareEventDeliveryResolution(owner, root.id, ids[0]!, () => caldavAdapter);
            const second = await commitEventDeliveryResolution(owner, again.proof, { ...resolveRequest, mutationId: randomUUID(), expectedLatestOperationId: again.preview.latestOperationId, expectedRemoteEtag: again.preview.remoteEtag });
            assert.equal((await deliverEventOutbox(second, () => caldavAdapter))?.status, "completed");
            assert.ok((await outbox()).filter(item => item.id !== second).every(item => item.status === "not-needed")); continue;
          }
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

        if (scenario === "lost" || scenario === "occurrence-lost" || (scenario === "cancel-lost" || scenario === "revive-lost" || scenario === "time-lost" || scenario === "recurrence-lost")) {
          assert.equal(result?.status, "unconfirmed"); assert.deepEqual(await maps(), mappings);
          mode = "ok";
          await db.update(eventOutbox).set({ nextAttemptAt: new Date(0) }).where(eq(eventOutbox.id, operation.id));
          result = await deliverEventOutbox(operation.id, () => caldavAdapter);
        }
        if (scenario.startsWith("grant-")) {
          assert.equal(result?.status, "conflict"); assert.equal(puts, scenario === "grant-before" ? 0 : 1);
          assert.deepEqual(await maps(), mappings); assert.equal((await outbox())[0]!.status, "conflict"); continue;
        }
        assert.equal(puts, 1);
        if (["recurrence-bare", "recurrence-order", "recurrence-zoned", "recurrence-all-day", "recurrence-floating", "recurrence-lost", "time-zoned", "time-all-day", "time-floating", "time-lost", "revive-zoned", "revive-all-day", "revive-floating", "revive-lost", "zoned", "all-day", "floating", "no-children", "lost", "occurrence-zoned", "occurrence-all-day", "occurrence-floating", "occurrence-lost", "cancel-zoned", "cancel-all-day", "cancel-floating", "cancel-lost"].includes(scenario)) {
          assert.equal(result?.status, "completed", JSON.stringify({ status: result?.status, error: result?.errorCode }));
          if (occurrence) assert.ok(data.includes(master) && data.includes(revival ? child : cancelled), "Native master and unrelated cancellation bytes are untouched");
          assert.ok((await maps()).every(map => map.etag === '"after"'));
          if (recurrenceEdit) assert.equal((await getEventSnapshot(root.id))!.recurrence, operation.payload.caldavSeries!.write.patch.recurrence);
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
          if (scenario === "race" || scenario === "occurrence-race" || (scenario === "cancel-race" || scenario === "revive-race" || scenario === "time-race" || scenario === "recurrence-race")) {
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
