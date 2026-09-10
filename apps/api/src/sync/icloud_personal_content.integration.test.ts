import assert from "node:assert/strict";
import dns from "node:dns/promises";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";

async function main() {
  assert.equal(process.env.ENVIRONMENT, "test");
  assert.ok(process.env.DATABASE_URL, "An explicit test database is required");
  const originalLookup = dns.lookup, originalFetch = globalThis.fetch;
  // Every provider DNS and HTTP operation is intercepted before importing the
  // module-scoped guarded transport. Neither iCloud nor external DNS is used.
  dns.lookup = (async (hostname: string) => {
    assert.match(hostname, /^(?:caldav\.icloud\.com|p123-caldav\.icloud\.com|dav\.example\.test)$/);
    return [{ address: "93.184.216.34", family: 4 }];
  }) as unknown as typeof dns.lookup;
  const { config } = await import("@musubi/config");
  const { db, user, events, calendarMembers, externalEvents, eventOutbox, saveCaldavAccount, importExternalCalendar, replaceExternalEventResource, applyLocalEventScope } = await import("@musubi/db");
  const { EventSchema } = await import("@musubi/types");
  const { encryptSecret } = await import("./crypto");
  const { caldavAdapter, prepareCaldavSeriesWrite } = await import("./adapters/caldav");
  const { normalizeCaldavResource } = await import("./adapters/caldav_time");
  const { prepareCaldavSeries } = await import("./caldav_scope");
  const { deliverEventOutbox } = await import("./event_delivery");
  const priorEnabled = config.api.icloudPersonalContentWritesEnabled, priorTime = config.api.eventTimeEditsEnabled;
  assert.equal(priorEnabled, false, "Compatibility fallback must default off");
  config.api.eventTimeEditsEnabled = true;
  const owner = `icloud-content-test-${randomUUID()}`;
  const component = (...lines: string[]) => ["BEGIN:VEVENT", "UID:family", ...lines, "END:VEVENT"].join("\r\n");
  const child = component("RECURRENCE-ID:20260916T090000Z", "DTSTART:20260916T110000Z", "DTEND:20260916T120000Z", "SUMMARY:Moved exception", "X-PRIVATE:Unchanged child");
  const before = ["BEGIN:VCALENDAR", "VERSION:2.0", component("DTSTART:20260915T090000Z", "DTEND:20260915T100000Z", "RRULE:FREQ=DAILY;COUNT=4", "SUMMARY:Master", "X-PRIVATE:Unchanged master", "BEGIN:VALARM", "ACTION:DISPLAY", "TRIGGER:-PT15M", "DESCRIPTION:Keep alarm", "END:VALARM"), child, "END:VCALENDAR", ""].join("\r\n");
  let data = before, etag = '"before"', permission = "missing", outcome = "ok", puts = 0, gets = 0, collection = "", resource = "";
  let onPut: (() => Promise<void>) | undefined;
  globalThis.fetch = async (input, init) => {
    const url = String(input); assert.equal(url, resource, "Only the selected resource is requested; no real HTTP");
    if (init?.method === "PROPFIND") {
      if (permission === "http403") return new Response(null, { status: 403 });
      const props = permission === "denied" ? "<d:privilege><d:read/></d:privilege>" : permission === "malformed" ? "junk" : "";
      const code = permission === "missing" ? "404 Not Found" : "200 OK";
      return new Response(`<d:multistatus xmlns:d="DAV:"><d:response><d:href>${resource}</d:href><d:propstat><d:prop><d:current-user-privilege-set>${props}</d:current-user-privilege-set></d:prop><d:status>HTTP/1.1 ${code}</d:status></d:propstat></d:response></d:multistatus>`, { status: 207, headers: { "content-type": "application/xml" } });
    }
    if (!init?.method || init.method === "GET") {
      gets++; return new Response(data, { status: 200, headers: { etag, "content-type": "text/calendar" } });
    }
    assert.equal(init?.method, "PUT"); puts++;
    assert.equal(new Headers(init?.headers).get("if-match"), '"before"', "Always conditional on original resource validator");
    if (outcome === "403") return new Response(null, { status: 403 });
    if (outcome === "412") { data = before.replace("Moved exception", "Concurrent exception"); etag = '"concurrent"'; return new Response(null, { status: 412 }); }
    data = String(init?.body); etag = '"after"';
    await onPut?.();
    if (outcome === "ambiguous-diverged") data = data.replace("Keep alarm", "Concurrent alarm");
    return new Response(null, { status: outcome.startsWith("ambiguous") ? 503 : 204, headers: { etag } });
  };
  await db.insert(user).values({ id: owner, name: "Fixture", email: `${owner}@example.test` });
  try {
    for (const provider of ["icloud", "generic", "foreign-account"]) {
      const account = await saveCaldavAccount(owner, provider === "icloud" ? "https://caldav.icloud.com/" : "https://dav.example.test/", `fixture-${provider}`, encryptSecret("fixture"));
      collection = provider === "generic" ? "https://dav.example.test/collection/" : "https://p123-caldav.icloud.com/collection/";
      resource = collection + "family.ics";
      const calendar = await importExternalCalendar("caldav", owner, account.id, "Fixture", { externalId: collection, name: "Fixture", color: "red", supportsEvents: true });
      const [master, ...children] = normalizeCaldavResource({ url: resource, etag: '"before"', data: before });
      const rootID = randomUUID();
      const event = (raw: typeof master, index: number) => EventSchema.parse({ ...raw, id: index ? randomUUID() : rootID, seriesID: index ? rootID : null, revision: 1, creatorID: owner, organizer: "", color: "red", calendars: [calendar.id], originCalendarID: calendar.id });
      const baseline = { ref: { externalEventId: resource, etag: '"before"', icalUid: "family" }, master: event(master, 0), children: children.map((item, index) => event(item, index + 1)) };
      const operation = { patch: { title: "Renamed", description: "New notes", location: "Room" } };
      const read = (op: any = operation) => caldavAdapter.readCaldavSeries!(owner, account.id, collection, baseline, undefined, op);
      config.api.icloudPersonalContentWritesEnabled = false; gets = puts = 0; permission = "missing"; data = before; etag = '"before"';
      await assert.rejects(read); assert.equal(gets + puts, 0, "Default-off blocks before native read");
      config.api.icloudPersonalContentWritesEnabled = true;
      if (provider !== "icloud") { await assert.rejects(read); assert.equal(gets + puts, 0, "Provider identity and account endpoint are both required"); continue; }
      for (const bad of ["denied", "malformed", "http403"]) { permission = bad; await assert.rejects(read); assert.equal(gets + puts, 0); }
      permission = "missing";
      for (const op of [undefined, { patch: { recurrence: "FREQ=DAILY;COUNT=5" } }, { patch: { title: "Renamed" }, time: { kind: "floating" } }, { patch: { title: "Occurrence" }, targetEventID: baseline.children[0]!.id }]) {
        await assert.rejects(() => caldavAdapter.readCaldavSeries!(owner, account.id, collection, baseline, undefined, op as any)); assert.equal(gets + puts, 0);
      }
      for (const nativeMarker of ["ORGANIZER:mailto:owner@example.test", "ATTENDEE:mailto:guest@example.test"]) {
        data = before.replace("SUMMARY:Master", "SUMMARY:Master\r\n" + nativeMarker);
        await assert.rejects(read, "Native meeting evidence cannot use the personal content path");
        assert.equal(puts, 0);
      }
      data = before;
      const resolution = () => caldavAdapter.readCaldavSeriesResolution!(owner, account.id, collection, baseline, before, undefined, undefined, operation);
      await resolution();
      for (const target of [null, baseline.children[0]!.id]) await assert.rejects(() => caldavAdapter.readCaldavSeriesResolution!(owner, account.id, collection, baseline, before, undefined, target, operation));
      await assert.rejects(() => caldavAdapter.readCaldavSeriesResolution!(owner, account.id, collection, baseline, before));
      const evidence = await read();
      const write = prepareCaldavSeriesWrite(evidence, baseline, operation.patch);
      const deliver = () => caldavAdapter.writeCaldavSeries!(owner, account.id, collection, write);
      const reset = (mode = "ok") => { data = before; etag = '"before"'; puts = gets = 0; outcome = mode; permission = "missing"; };
      reset();
      const confirmed = await deliver(); assert.equal(confirmed.master.title, "Renamed"); assert.equal(puts, 1); assert.ok(data.includes(child), "Detached exception stays byte-for-byte intact"); assert.match(data, /DESCRIPTION:Keep alarm/); assert.match(data, /X-PRIVATE:Unchanged master/);
      await deliver(); assert.equal(puts, 1, "Desired complete resource replay does not issue another PUT");
      for (const bad of ["denied", "http403", "malformed"]) { reset(); permission = bad; await assert.rejects(deliver); assert.equal(puts + gets, 0, "Delivery rechecks fresh permission"); }
      reset(); config.api.icloudPersonalContentWritesEnabled = false; await assert.rejects(deliver); assert.equal(puts + gets, 0); config.api.icloudPersonalContentWritesEnabled = true;
      reset("403"); await assert.rejects(deliver, (error: any) => error.providerStatus === 403 && error.outcome === "not-written"); assert.equal(data, before); assert.equal(puts, 1);
      reset("412"); await assert.rejects(deliver, (error: any) => error.providerStatus === 412 && error.outcome === "not-written"); assert.match(data, /Concurrent exception/); outcome = "ok"; await assert.rejects(deliver); assert.equal(puts, 1, "Stale intent never rebases over concurrent exception");
      reset("ambiguous"); await assert.rejects(deliver, (error: any) => error.outcome === "unconfirmed"); outcome = "ok"; assert.equal((await deliver()).master.title, "Renamed"); assert.equal(puts, 1, "Full-resource readback adopts applied ambiguous write");
      reset("ambiguous-diverged"); await assert.rejects(deliver, (error: any) => error.outcome === "unconfirmed"); outcome = "ok"; await assert.rejects(deliver); assert.equal(puts, 1, "Readback rejects changed alarm even when requested fields match");
    }
    for (const revokeAfterPut of [false, true]) {
      const account = await saveCaldavAccount(owner, "https://caldav.icloud.com/", `worker-${revokeAfterPut}`, encryptSecret("fixture"));
      collection = `https://p123-caldav.icloud.com/worker-${revokeAfterPut}/`;
      resource = collection + "family.ics";
      const calendar = await importExternalCalendar("caldav", owner, account.id, "Fixture", { externalId: collection, name: "Fixture", color: "red", supportsEvents: true });
      data = before; etag = '"before"'; outcome = "ok"; permission = "missing"; gets = puts = 0;
      await replaceExternalEventResource("caldav", owner, calendar.id, collection, resource, normalizeCaldavResource({ url: resource, etag, data }).map(event => ({ externalId: event.externalId, etag, icalUid: "family", values: { title: event.title, start: event.start, end: event.end, color: "red", isAllDay: event.isAllDay, description: event.description, location: event.location, organizer: event.organizer ?? "", recurrence: event.recurrence, url: event.url }, time: { timeModel: event.timeModel!, externalSeriesID: event.externalSeriesID, originalStart: event.originalStart, isCanceled: event.isCanceled } })));
      const mappings = await db.select().from(externalEvents).where(eq(externalEvents.calendarID, calendar.id));
      const rootMapping = mappings.find(item => !item.originalStart)!;
      const root = (await db.select().from(events).where(eq(events.id, rootMapping.eventID)))[0]!;
      const request = { operationID: randomUUID(), scope: "series", action: "update", expectedRevision: root.revision, patch: { title: "Scope renamed" } };
      const candidate = await applyLocalEventScope(root.id, owner, request, { prepareProvider: true });
      assert.equal(candidate.status, "caldav_required"); if (candidate.status !== "caldav_required") throw new Error("Missing scope context");
      const prepared = await prepareCaldavSeries(candidate.context, request);
      assert.equal((await applyLocalEventScope(root.id, owner, request, { caldav: prepared })).status, "saved");
      const operation = (await db.select().from(eventOutbox).where(eq(eventOutbox.calendarID, calendar.id)))[0]!;
      assert.ok(operation, "Scope edit enqueues its exact durable operation");
      assert.equal(puts, 0, "Scope admission is read-only at the provider");
      if (revokeAfterPut) onPut = async () => { await db.update(calendarMembers).set({ role: "viewer" }).where(eq(calendarMembers.calendarID, calendar.id)); };
      const result = await deliverEventOutbox(operation.id, () => caldavAdapter);
      onPut = undefined;
      assert.equal(puts, 1); assert.ok(data.includes(child)); assert.match(data, /SUMMARY:Scope renamed/);
      const afterMappings = await db.select().from(externalEvents).where(eq(externalEvents.calendarID, calendar.id));
      if (revokeAfterPut) {
        assert.notEqual(result?.status, "completed", "Grant revoked during PUT cannot receive a successful ACK");
        assert.ok(afterMappings.every(item => item.etag === '"before"'), "Late ACK cannot advance mapping validators across revoked authority");
      } else {
        assert.equal(result?.status, "completed", JSON.stringify({ status: result?.status, error: result?.errorCode }));
        assert.ok(afterMappings.every(item => item.etag === '"after"'), "Worker ACK advances the complete resource family");
      }
    }
    console.log("iCloud fallback adapter integration: default-off, verified account/source, fresh ACL, master-only scope, conditional preservation, 403/412 and ambiguous readback OK");
  } finally {
    await db.delete(user).where(eq(user.id, owner));
    globalThis.fetch = originalFetch; dns.lookup = originalLookup;
    config.api.icloudPersonalContentWritesEnabled = priorEnabled; config.api.eventTimeEditsEnabled = priorTime;
  }
}
main().then(() => process.exit(0), error => { console.error(error); process.exit(1); });
