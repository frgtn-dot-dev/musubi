import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { eq, and, sql } from "drizzle-orm";
import express from "express";
async function main() {
  assert.equal(process.env.ENVIRONMENT, "test");
  const { config } = await import("@musubi/config");
  const { db, user, events, calendarMembers, eventOutbox, externalEvents, saveCaldavAccount, importExternalCalendar, replaceExternalEventResource, getEventSnapshot, replaceMemberToken, claimEventOutbox, completeEventOutbox, confirmCaldavAlarm, deleteExternalEvent, commitEventDeliveryResolution, getEventDeliveryResolutionReplay, setCursor, externalCalendars, getEventDeliveryStatus, patchEventAndCalendarLinks, upsertExternalTask, tasks, externalTasks } = await import("@musubi/db");
  const { caldavAdapter } = await import("./adapters/caldav");
  const { normalizeCaldavResource } = await import("./adapters/caldav_time");
  const { withoutCaldavAlarm } = await import("./adapters/caldav_alarms");
  const { queueCaldavAlarms } = await import("./caldav_alarms");
  const { prepareEventDeliveryResolution } = await import("./event_resolution");
  const { syncProvider } = await import("./engine");
  const { deliverEventOutbox } = await import("./event_delivery");
  const { encryptSecret } = await import("./crypto");
  const { issueMemberToken } = await import("../federation_tokens");
  const { requireAuth } = await import("../middleware/require_auth");
  const { middlewareErrorHandler } = await import("../middleware/error_handler");
  const { handlerGetProviderEventState, handlerProviderReminderEdit } = await import("../handlers/events");
  const { handlerDiscardEventAlarm } = await import("../handlers/event_delivery");
  const { CLIENT_VERSION_HEADER, PRODUCT_VERSION } = await import("@musubi/types");
  let data = "", etag = '"before"', puts = 0, allowed = true, mode = "ok";
  let lookupReads = 0;
  let onPut: (() => Promise<void>) | undefined;
  const fixture = createServer(async (req, res) => {
    if (mode === "lookup-missing" && req.method === "PROPFIND") {
      res.writeHead(207, { "content-type": "application/xml" });
      if (req.url === "/home/") { lookupReads++; return res.end('<d:multistatus xmlns:d="DAV:"/>'); }
      return res.end(`<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:response><d:href>${req.url}</d:href><d:propstat><d:prop><d:current-user-principal><d:href>/principal/</d:href></d:current-user-principal><c:calendar-home-set><d:href>/home/</d:href></c:calendar-home-set></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>`);
    }
    if (req.method === "PROPFIND") { res.writeHead(207, { "content-type": "application/xml" }); return res.end(`<d:multistatus xmlns:d="DAV:"><d:response><d:href>${req.url}</d:href><d:propstat><d:prop><d:current-user-privilege-set>${allowed ? "<d:privilege><d:write-content/></d:privilege>" : ""}</d:current-user-privilege-set></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>`); }
    if (req.method === "GET") { res.writeHead(200, { "content-type": "text/calendar", etag }); return res.end(data); }
    assert.equal(req.method, "PUT"); puts++;
    if (mode === "race") etag = '"raced"';
    if (req.headers["if-match"] !== etag) { res.writeHead(412); return res.end(); }
    let body = ""; for await (const chunk of req) body += chunk;
    data = body; etag = '"after"'; await onPut?.();
    res.writeHead(mode === "lost" ? 503 : 204, { etag }); res.end();
  });
  await new Promise<void>(resolve => fixture.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(fixture.address() as any).port}`;
  const app = express(); app.use(express.json());
  app.get("/events/:eventId/provider-state", requireAuth, handlerGetProviderEventState);
  app.post("/events/:eventId/provider-reminders", requireAuth, handlerProviderReminderEdit);
  app.post("/events/:eventId/delivery/:operationId/discard-alarm", requireAuth, handlerDiscardEventAlarm);
  app.use(middlewareErrorHandler);
  const api = app.listen(0, "127.0.0.1"); await new Promise<void>(resolve => api.once("listening", resolve));
  const apiOrigin = `http://127.0.0.1:${(api.address() as any).port}`;
  const flags = [config.api.caldavAlarmEditsEnabled, config.api.providerReminderEditsEnabled, config.api.eventTimeEditsEnabled];
  try {
    for (const scenarioName of ["series-overnight", "series-zoned", "series-all-day", "series-off", "series-create", "series-lost", "series-race", "series-resolve", "series-resolve-content", "series-resolve-rule", "series-resolve-scope", "series-discard", "series-flag", "series-no-privilege", "series-lease", "series-child", "series-retired", "series-child-race", "series-missing-scope", "wrong-scope", "lookup-missing-initial", "discard-lookup-missing", "zoned", "all-day", "off", "create", "flag", "no-privilege", "unsupported", "stale-editor", "concurrent", "lost", "race", "lease", "delete-during", "grant", "generic-ack", "tamper", "resolve", "resolve-stale", "resolve-grant", "resolve-unknown", "resolve-content", "resolve-repeated", "discard", "discard-grant", "discard-lease", "discard-local", "discard-newer", "storage-failure"]) {
      const series = scenarioName.startsWith("series-");
      const scenario = series ? scenarioName.slice(7) : scenarioName;
      console.log(`CalDAV event alarm scenario: ${scenarioName}`);
      const owner = `alarm-${randomUUID()}`, credential = issueMemberToken();
      await db.insert(user).values({ id: owner, name: "Fixture", email: `${owner}@example.test`, isExternal: true }); await replaceMemberToken(owner, credential.tokenHash);
      config.api.caldavAlarmEditsEnabled = true; config.api.providerReminderEditsEnabled = false; config.api.eventTimeEditsEnabled = false;
      try {
        const account = await saveCaldavAccount(owner, origin + "/", "fixture", encryptSecret("fixture"));
        const collection = origin + "/collection/", resource = collection + "one.ics";
        const calendar = await importExternalCalendar("caldav", owner, account.id, "Fixture", { externalId: collection, name: "Fixture", color: "#7A8BA3", supportsEvents: true });
        data = ["BEGIN:VCALENDAR", "VERSION:2.0", "BEGIN:VEVENT", "UID:one", scenario === "all-day" ? "DTSTART;VALUE=DATE:20260329" : "DTSTART;TZID=Europe/Prague:20260329T090000", scenario === "all-day" ? "DTEND;VALUE=DATE:20260330" : "DTEND;TZID=Europe/Prague:20260329T100000", "SUMMARY:One", "X-PRIVATE:Never disclose", "BEGIN:VALARM", "ACTION:DISPLAY", "TRIGGER:-PT15M", "DESCRIPTION:Private alarm", "END:VALARM", "END:VEVENT", "END:VCALENDAR", ""].join("\r\n");
        if (series) data = data.replace("SUMMARY:One", "RRULE:FREQ=DAILY;COUNT=4\r\nSUMMARY:One").replace(/20260329T/g, "20260328T");
        if (scenario === "overnight") data = data.replace("20260328T090000", "20260328T230000").replace("20260328T100000", "20260329T010000");
        if (scenario === "create") data = withoutCaldavAlarm(data);
        etag = '"before"'; puts = 0; allowed = true; mode = "ok"; onPut = undefined;
        const persist = (accessContext?: import("@musubi/db").ExternalCalendarAccessContext) => replaceExternalEventResource("caldav", owner, calendar.id, collection, resource, normalizeCaldavResource({ url: resource, etag, data }).map(event => ({ externalId: event.externalId, etag, icalUid: "one", values: { title: event.title, start: event.start, end: event.end, color: "#7A8BA3", isAllDay: event.isAllDay, description: event.description, location: event.location, organizer: "", recurrence: event.recurrence, url: event.url }, providerState: event.providerState, time: { timeModel: event.timeModel! } })), accessContext);
        await persist();
        const [local] = await db.select().from(events).where(eq(events.creatorID, owner));
        const original = await getEventSnapshot(local.id), initialData = data;
        const outbox = () => db.select().from(eventOutbox).where(eq(eventOutbox.userID, owner));
        const maps = () => db.select().from(externalEvents).where(eq(externalEvents.eventID, local.id));
        const headers = { authorization: `Bearer ${credential.raw}`, "content-type": "application/json", [CLIENT_VERSION_HEADER]: PRODUCT_VERSION };
        const assertMissingLookupPreservesMirror = async () => {
          await upsertExternalTask("caldav", owner, calendar.id, collection, collection + "task.ics", { title: "Keep native task", description: null, status: "needs-action", start: null, due: null, isAllDay: false, completedAt: null, percentComplete: 0, priority: 0, recurrence: null, relatedTo: null, sequence: 0, url: null }, '"task"', "task");
          const snapshot = async () => ({ event: await getEventSnapshot(local.id), mappings: await maps(), tasks: await db.select().from(tasks).where(eq(tasks.creatorID, owner)), taskMappings: await db.select().from(externalTasks).where(eq(externalTasks.calendarID, calendar.id)) });
          const before = await snapshot();
          const [link] = await db.select().from(externalCalendars).where(eq(externalCalendars.calendarID, calendar.id));
          assert.equal(link.cursor, null);
          config.api.caldavAlarmEditsEnabled = false; config.api.providerReminderEditsEnabled = false; config.api.eventTimeEditsEnabled = false;
          mode = "lookup-missing"; lookupReads = 0;
          // Discovery sees the collection; the real adapter's later authenticated
          // WebDAV lookup is incomplete and must fail without an authoritative reset.
          await assert.rejects(syncProvider({ ...caldavAdapter, listCalendars: async () => ({ calendars: [{ externalId: collection, name: "Fixture", color: "#7A8BA3", supportsEvents: true, supportsTasks: true }], taskListsComplete: true }) }, owner, { id: account.id, label: "Fixture" }), /CalDAV property response is incomplete or ambiguous/);
          assert.ok(lookupReads > 0, "Real CalDAV fetchChanges performs its missing collection lookup");
          assert.deepEqual(await snapshot(), before, "Nonauthoritative missing lookup cannot sweep events or tasks with a null cursor");
          assert.equal(puts, 0);
        };
        if (scenario === "lookup-missing-initial") { await assertMissingLookupPreservesMirror(); continue; }
        if (["child", "retired"].includes(scenario)) await db.insert(events).values({ ...local, id: randomUUID(), seriesID: local.id, originalStart: { kind: "instant", value: local.start.toISOString() }, recurrence: null, deletedAt: scenario === "retired" ? new Date() : null });
        if (scenario === "flag") config.api.caldavAlarmEditsEnabled = false;
        if (scenario === "no-privilege") allowed = false;
        if (scenario === "unsupported") data = data.replace("DESCRIPTION:Private alarm", "REPEAT:2\r\nDURATION:PT5M\r\nDESCRIPTION:Private alarm");
        const observationResponse = await fetch(`${apiOrigin}/events/${local.id}/provider-state`, { headers });
        assert.equal(observationResponse.status, 200); const observation = await observationResponse.json() as any;
        assert.ok(!JSON.stringify(observation).includes("Private alarm") && !JSON.stringify(observation).includes("Never disclose"));
        if (["flag", "no-privilege", "unsupported", "child", "retired"].includes(scenario)) { assert.equal(observation.reminderEdit, undefined); assert.equal(puts, 0); continue; }
        assert.equal(observation.reminderEdit?.provider, "caldav");
        assert.equal(observation.reminderEdit.scope, series ? "series" : undefined);
        const request = { ...(series ? { scope: "series" } : {}), provider: "caldav", operationID: randomUUID(), expectedRevision: local.revision, expectedStateVersion: observation.version, alarms: { minutesBeforeStart: scenario === "off" ? null : 30 } };
        if (scenario === "missing-scope" || scenario === "wrong-scope") {
          await assert.rejects(() => queueCaldavAlarms(owner, local.id, { ...request, scope: series ? undefined : "series" }));
          assert.equal((await outbox()).length, 0); assert.equal(puts, 0); continue;
        }
        if (scenario === "stale-editor") { etag = '"fresh"'; await assert.rejects(() => queueCaldavAlarms(owner, local.id, request)); assert.equal((await outbox()).length, 0); continue; }
        if (scenario === "storage-failure") {
          await db.execute(sql.raw("CREATE FUNCTION musubi_alarm_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic alarm storage failure'; END $$"));
          await db.execute(sql.raw("CREATE TRIGGER musubi_alarm_failure BEFORE INSERT ON event_outbox FOR EACH ROW EXECUTE FUNCTION musubi_alarm_failure()"));
          try {
            await assert.rejects(() => queueCaldavAlarms(owner, local.id, request), error => {
              assert.equal((error as Error).message, "CalDAV alarm persistence failed; transaction was rolled back.");
              assert.equal((error as Error & { cause?: unknown }).cause, undefined); assert.ok(!String((error as Error).stack).includes("Private alarm")); return true;
            });
            assert.equal((await outbox()).length, 0); assert.deepEqual(await getEventSnapshot(local.id), original);
          } finally { await db.execute(sql.raw("DROP TRIGGER musubi_alarm_failure ON event_outbox")); await db.execute(sql.raw("DROP FUNCTION musubi_alarm_failure()")); }
          continue;
        }
        const queued = await fetch(`${apiOrigin}/events/${local.id}/provider-reminders`, { method: "POST", headers, body: JSON.stringify(request) });
        const queuedText = await queued.text(); assert.equal(queued.status, 202, queuedText);
        const operationID = JSON.parse(queuedText).operationID;
        assert.equal((await queueCaldavAlarms(owner, local.id, request)).operationID, operationID);
        await assert.rejects(() => queueCaldavAlarms(owner, local.id, { ...request, alarms: { minutesBeforeStart: 10 } }));
        assert.equal(await persist(), false, "Full pull skips only the pending resource");
        assert.deepEqual(await getEventSnapshot(local.id), original);
        assert.equal((await outbox())[0].payload.caldavAlarm!.request.scope, series ? "series" : undefined);
        if (scenario === "child-race") {
          await db.insert(events).values({ ...local, id: randomUUID(), seriesID: local.id, originalStart: { kind: "instant", value: local.start.toISOString() }, recurrence: null, deletedAt: new Date() });
          const refused = await deliverEventOutbox(operationID, () => caldavAdapter);
          assert.notEqual(refused?.status, "completed"); assert.equal(puts, 0); continue;
        }
        if (scenario === "concurrent") await assert.rejects(() => queueCaldavAlarms(owner, local.id, { ...request, operationID: randomUUID() }));
        if (scenario === "grant") await db.update(calendarMembers).set({ role: "viewer" }).where(and(eq(calendarMembers.calendarID, calendar.id), eq(calendarMembers.userID, owner)));
        if (scenario === "generic-ack") {
          const claim = await claimEventOutbox(operationID); assert.ok(claim);
          await completeEventOutbox(operationID, claim.leaseToken!, { externalEventId: resource, etag, icalUid: "one" }, { externalEventId: resource, etag, icalUid: "one" });
          assert.equal((await outbox())[0].status, "attempting"); continue;
        }
        if (scenario === "tamper") {
          const row = (await outbox())[0]; row.payload.caldavAlarm!.after = row.payload.caldavAlarm!.after.replace("SUMMARY:One", "SUMMARY:Tampered");
          await db.update(eventOutbox).set({ payload: row.payload }).where(eq(eventOutbox.id, operationID));
        }
        if (scenario.startsWith("resolve") || scenario.startsWith("discard")) { data = data.replace("-PT15M", "-PT20M"); etag = '"remote"'; }
        if (["lost", "race"].includes(scenario)) mode = scenario;
        if (scenario === "lease") onPut = async () => { await db.update(eventOutbox).set({ leaseUntil: new Date(0) }).where(eq(eventOutbox.id, operationID)); };
        if (scenario === "delete-during") onPut = async () => { await deleteExternalEvent("caldav", calendar.id, resource); };
        const delivered = await deliverEventOutbox(operationID, () => caldavAdapter);
        if (["grant", "tamper"].includes(scenario)) { assert.equal(puts, 0); assert.notEqual(delivered?.status, "completed"); continue; }
        if (["lease", "delete-during"].includes(scenario)) { assert.notEqual((await outbox())[0].status, "completed"); assert.equal((await maps())[0].etag, '"before"'); continue; }
        if (scenario === "race") { assert.equal(delivered?.status, "conflict"); assert.equal(data, initialData); continue; }
        if (scenario === "lost") {
          assert.notEqual(delivered?.status, "completed"); mode = "ok";
          await db.update(eventOutbox).set({ nextAttemptAt: new Date(0) }).where(eq(eventOutbox.id, operationID));
          await deliverEventOutbox(operationID, () => caldavAdapter); assert.equal(puts, 1);
        }
        if (scenario.startsWith("discard")) {
          assert.equal(delivered?.status, "conflict");
          data = data.replace("SUMMARY:One", "SUMMARY:Native update").replace("DESCRIPTION:Private alarm", "X-UNSUPPORTED:alarm\r\nDESCRIPTION:Private alarm");
          await assert.rejects(() => prepareEventDeliveryResolution(owner, local.id, operationID, () => caldavAdapter));
          const [link] = await db.select().from(externalCalendars).where(eq(externalCalendars.calendarID, calendar.id));
          const staleContext = { provider: "caldav" as const, linkID: link.id, userID: owner, accountID: account.id, externalCalendarID: collection, revision: link.providerAccessRevision };
          assert.equal(await persist(), false);
          const sibling = normalizeCaldavResource({ url: collection + "sibling.ics", etag: '"sibling"', data: initialData.replace("UID:one", "UID:sibling") })[0];
          assert.equal(await replaceExternalEventResource("caldav", owner, calendar.id, collection, collection + "sibling.ics", [{ externalId: collection + "sibling.ics", etag: '"sibling"', icalUid: "sibling", values: { title: sibling.title, start: sibling.start, end: sibling.end, color: "#7A8BA3", isAllDay: sibling.isAllDay, description: sibling.description, location: sibling.location, organizer: "", recurrence: null, url: null }, time: { timeModel: sibling.timeModel! } }], staleContext), true, "Unrelated resource continues syncing");
          await setCursor(calendar.id, "cursor-after-skipped", staleContext);
          assert.equal((await getEventDeliveryStatus(owner, local.id)).targets[0].alarmDiscardRevision, local.revision);
          let discardRevision = local.revision;
          let newer: any;
          if (["discard-local", "discard-newer"].includes(scenario)) {
            const saved = (await outbox()).find(row => row.id === operationID)!;
            const change = await patchEventAndCalendarLinks(local.id, local.revision, { title: "New local content" }, false, scenario === "discard-newer" ? [{ id: randomUUID(), mutationID: randomUUID(), actorID: owner, position: 0, eventID: local.id, calendarID: calendar.id, externalCalendarLinkID: link.id, provider: "caldav", userID: owner, accountID: account.id, externalCalendarID: collection, externalEventID: resource, expectedEtag: saved.expectedEtag, icalUid: "one", action: "update", payload: { event: saved.payload.event, patch: { title: "New local content" } } }] : []);
            assert.equal(change.status, "saved");
            newer = (await outbox()).find(row => row.id !== operationID);
            discardRevision++;
            assert.equal((await getEventDeliveryStatus(owner, local.id)).targets[0].alarmDiscardRevision, discardRevision);
          }
          const path = `${apiOrigin}/events/${local.id}/delivery/${operationID}/discard-alarm`;
          assert.notEqual((await fetch(path, { method: "POST", headers, body: JSON.stringify({ expectedRevision: discardRevision + 1 }) })).status, 200);
          if (scenario === "discard-grant") await db.update(calendarMembers).set({ role: "viewer" }).where(and(eq(calendarMembers.calendarID, calendar.id), eq(calendarMembers.userID, owner)));
          if (scenario === "discard-lease") await db.update(eventOutbox).set({ leaseToken: randomUUID(), leaseUntil: new Date(Date.now() + 60_000) }).where(eq(eventOutbox.id, operationID));
          const discarded = await fetch(path, { method: "POST", headers, body: JSON.stringify({ expectedRevision: discardRevision }) });
          if (!["discard", "discard-local", "discard-newer", "discard-lookup-missing"].includes(scenario)) { assert.notEqual(discarded.status, 200); assert.equal((await outbox())[0].status, "conflict"); continue; }
          assert.equal(discarded.status, 200, await discarded.text());
          assert.equal((await outbox()).find(row => row.id === operationID)!.status, "not-needed"); assert.equal((await outbox()).find(row => row.id === operationID)!.payload.caldavAlarm!.before, initialData);
          const [reset] = await db.select().from(externalCalendars).where(eq(externalCalendars.id, link.id)); assert.equal(reset.cursor, null); assert.equal(reset.providerAccessRevision, staleContext.revision + 1);
          await assert.rejects(() => setCursor(calendar.id, "stale-cursor", staleContext));
          await assert.rejects(() => persist(staleContext));
          assert.equal((await fetch(path, { method: "POST", headers, body: JSON.stringify({ expectedRevision: discardRevision }) })).status, 200);
          if (scenario === "discard-lookup-missing") { await assertMissingLookupPreservesMirror(); continue; }
          if (newer) { assert.deepEqual((await outbox()).find(row => row.id === newer.id), newer); assert.equal((await getEventSnapshot(local.id))!.title, "New local content"); }
          else { await persist({ ...staleContext, revision: staleContext.revision + 1 }); assert.equal((await getEventSnapshot(local.id))!.title, "Native update"); }
          assert.equal(puts, 0); continue;
        }
        let finalID = operationID;
        if (scenario.startsWith("resolve")) {
          assert.equal(delivered?.status, "conflict"); assert.equal(puts, 0);
          if (scenario === "resolve-unknown") data = data.replace("DESCRIPTION:Private alarm", "X-UNKNOWN:yes\r\nDESCRIPTION:Private alarm");
          if (scenario === "resolve-rule") data = data.replace("COUNT=4", "COUNT=5");
          if (scenario === "resolve-content") data = data.replace("SUMMARY:One", "SUMMARY:Remote");
          if (["resolve-unknown", "resolve-content", "resolve-rule"].includes(scenario)) { await assert.rejects(() => prepareEventDeliveryResolution(owner, local.id, operationID, () => caldavAdapter)); continue; }
          const prepared = await prepareEventDeliveryResolution(owner, local.id, operationID, () => caldavAdapter);
          if (scenario === "resolve-scope") {
            const tampered = structuredClone(prepared.proof); delete tampered.caldavAlarm!.next.request.scope;
            await assert.rejects(() => commitEventDeliveryResolution(owner, tampered, { mutationId: randomUUID(), expectedLocalRevision: local.revision, expectedLatestOperationId: operationID, expectedRemoteExists: true, expectedRemoteEtag: etag, expectedReminderStateVersion: prepared.preview.caldavAlarmResolution!.stateVersion }));
            assert.equal((await outbox()).length, 1); assert.equal(puts, 0); continue;
          }
          assert.equal(prepared.preview.caldavAlarmResolution?.scope, series ? "series" : undefined);
          assert.equal(prepared.preview.caldavAlarmResolution?.remote.minutesBeforeStart, 20);
          assert.ok(!JSON.stringify(prepared.preview).includes("Private alarm"));
          const confirmation = { mutationId: randomUUID(), expectedLocalRevision: local.revision, expectedLatestOperationId: operationID, expectedRemoteExists: true, expectedRemoteEtag: etag, expectedReminderStateVersion: prepared.preview.caldavAlarmResolution!.stateVersion };
          await assert.rejects(() => commitEventDeliveryResolution(owner, prepared.proof, { ...confirmation, expectedReminderStateVersion: undefined }));
          if (scenario === "resolve-stale") confirmation.expectedReminderStateVersion = "0".repeat(64);
          if (scenario === "resolve-grant") await db.update(calendarMembers).set({ role: "viewer" }).where(and(eq(calendarMembers.calendarID, calendar.id), eq(calendarMembers.userID, owner)));
          if (["resolve-stale", "resolve-grant"].includes(scenario)) { await assert.rejects(() => commitEventDeliveryResolution(owner, prepared.proof, confirmation)); assert.equal((await outbox()).length, 1); continue; }
          finalID = await commitEventDeliveryResolution(owner, prepared.proof, confirmation);
          assert.equal(await getEventDeliveryResolutionReplay(owner, local.id, operationID, confirmation), finalID);
          assert.equal(await commitEventDeliveryResolution(owner, prepared.proof, confirmation), finalID);
          if (scenario === "resolve-repeated") {
            data = data.replace("-PT20M", "-PT25M"); etag = '"again"'; await deliverEventOutbox(finalID, () => caldavAdapter);
            const next = await prepareEventDeliveryResolution(owner, local.id, finalID, () => caldavAdapter);
            finalID = await commitEventDeliveryResolution(owner, next.proof, { ...confirmation, mutationId: randomUUID(), expectedLatestOperationId: finalID, expectedRemoteEtag: etag, expectedReminderStateVersion: next.preview.caldavAlarmResolution!.stateVersion });
          }
          assert.equal(await persist(), false); await deliverEventOutbox(finalID, () => caldavAdapter);
        }
        assert.equal((await outbox()).find(row => row.id === finalID)!.status, "completed");
        assert.deepEqual(await getEventSnapshot(local.id), original);
        assert.equal(withoutCaldavAlarm(data), withoutCaldavAlarm(initialData));
        if (scenario !== "off") assert.ok(data.includes(scenario === "create" ? "DESCRIPTION:Calendar reminder" : "DESCRIPTION:Private alarm"));
        assert.equal((await maps())[0].etag, etag);
        assert.equal((await db.select().from(tasks).where(eq(tasks.creatorID, owner))).length, 0, "Provider alarm changes do not create Musubi tasks");
        assert.equal(await confirmCaldavAlarm(finalID, randomUUID()), false);
        await persist();
      } finally { await db.delete(user).where(eq(user.id, owner)); }
    }
    console.log("CalDAV event and explicit finite series alarms: all scenarios passed");
  } finally {
    [config.api.caldavAlarmEditsEnabled, config.api.providerReminderEditsEnabled, config.api.eventTimeEditsEnabled] = flags;
    fixture.closeAllConnections(); api.closeAllConnections();
    await Promise.all([new Promise<void>(resolve => fixture.close(() => resolve())), new Promise<void>(resolve => api.close(() => resolve()))]); await db.$client.end();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
