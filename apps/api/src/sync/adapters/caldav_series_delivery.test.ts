import { planEventScope, resolveEventTimeEdit } from "@musubi/calendar";
import type { OccurrenceStart } from "@musubi/types";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { EventSchema } from "@musubi/types";
import { normalizeCaldavResource } from "./caldav_time";

process.env.DATABASE_URL ??= "postgres://user:pass@localhost:5432/test";
process.env.ENVIRONMENT ??= "test";
process.env.BETTER_AUTH_URL ??= "http://localhost:7531";
process.env.FEDERATION_ALLOW_PRIVATE_HOSTS = "true";

async function main() {
  const { config } = await import("@musubi/config");
  config.api.eventTimeEditsEnabled = true;
  const { prepareCaldavSeriesSplit, createCaldavSplitResource, prepareCaldavSeriesDeletion, deleteCaldavSeriesResource, prepareCaldavSeriesWrite, deliverCaldavSeriesResource } = await import("./caldav");
  const { caldavSeriesEvidence, sameCaldavResource } = await import("./caldav_series");
  let data = "", etag = '"before"', mode = "ok", puts = 0, gets = 0;
  let putBody = "", putEtag: string | undefined;
  let missing = false, deletes = 0;
  let createPath = "", createData: string | null = null, createPuts = 0;
  const server = createServer(async (req, res) => {
    if (req.url === createPath) {
      if (req.method === "GET") {
        if (createData === null) { res.writeHead(404); return res.end(); }
        res.writeHead(mode === "create-unreadable" ? 403 : 200, { "content-type": "text/calendar", etag: mode === "create-weak" ? 'W/"created"' : '"created"' }); return res.end(createData);
      }
      assert.equal(req.method, "PUT"); assert.equal(req.headers["if-none-match"], "*"); createPuts++;
      if (mode === "create-race") createData = "Foreign resource";
      if (createData !== null) { res.writeHead(412); return res.end(); }
      let body = ""; for await (const chunk of req) body += chunk; createData = body;
      if (mode === "changed-after-put") createData = body.replace("Keep alarm", "Changed alarm");
      if (mode === "lost") { req.socket.destroy(); return; }
      res.writeHead(mode === "applied-503" ? 503 : 201); return res.end();
    }
    if (req.method === "GET") {
      gets++;
      if (missing) { res.writeHead(mode === "delete-unreadable" ? 403 : 404); res.end(); return; }
      if (mode === "redirect-get") { res.writeHead(302, { location: "/collection/other.ics" }); res.end(); return; }
      res.writeHead(mode === "partial" ? 206 : 200, { "content-type": "text/calendar", etag: mode === "weak" ? 'W/"weak"' : etag, ...(mode === "partial" ? { "content-range": "bytes 0-5/1000" } : {}) });
      res.end(mode === "invalid-utf8" ? Buffer.from([0xc3, 0x28]) : data);
      return;
    }
    if (req.method === "DELETE") {
      deletes++;
      if (mode === "delete-race") { etag = '"raced"'; data = data.replace("SUMMARY:Moved", "SUMMARY:Concurrent child"); }
      if (req.headers["if-match"] !== etag) { res.writeHead(412); res.end(); return; }
      missing = true;
      if (mode === "delete-recreated") { missing = false; etag = '"recreated"'; data = data.replace("SUMMARY:Master", "SUMMARY:Recreated"); }
      if (mode === "lost") { req.socket.destroy(); return; }
      if (mode === "applied-503") { res.writeHead(503); res.end(); return; }
      res.writeHead(204); res.end(); return;
    }
    assert.equal(req.method, "PUT");
    puts++;
    putEtag = req.headers["if-match"] as string;
    putBody = "";
    for await (const chunk of req) putBody += chunk;
    if (mode === "race") { data = data.replace("SUMMARY:Moved", "SUMMARY:Concurrent child"); etag = '"raced"'; }
    if (putEtag !== etag) { res.writeHead(412); res.end(); return; }
    if (mode === "redirect-put") { res.writeHead(307, { location: "/collection/other.ics" }); res.end(); return; }
    if (mode === "retry-baseline") { res.writeHead(503); res.end(); return; }
    data = putBody;
    etag = '"after"';
    if (mode === "changed-after-put") data = data.replace("DESCRIPTION:Keep alarm", "DESCRIPTION:Externally changed alarm");
    if (mode === "lost") { req.socket.destroy(); return; }
    if (mode === "applied-503") { res.writeHead(503); res.end(); return; }
    res.writeHead(204, { etag }); res.end();
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const collection = `http://127.0.0.1:${address.port}/collection/`;
  try {
    for (const kind of ["zoned", "all-day", "floating"]) {
      const stamp = (name: string, day: string, hour: string) => kind === "all-day" ? `${name};VALUE=DATE:202603${day}` : `${name}${kind === "zoned" ? ";TZID=Europe/Prague" : ""}:202603${day}T${hour}0000`;
      const component = (...lines: string[]) => ["BEGIN:VEVENT", "UID:family", ...lines, "END:VEVENT"].join("\r\n");
      const master = component(stamp("DTSTART", "28", "09"), stamp("DTEND", "29", "10"), "RRULE:FREQ=DAILY;COUNT=4", "SUMMARY:Master", "X-PRIVATE;LANGUAGE=cs:Folded", " extension", "BEGIN:VALARM", "ACTION:DISPLAY", "TRIGGER:-PT15M", "DESCRIPTION:Keep alarm", "END:VALARM");
      const child = component(stamp("RECURRENCE-ID", "29", "09"), stamp("DTSTART", "30", "14"), stamp("DTEND", "31", "16"), "SUMMARY:Moved");
      const cancelled = component(stamp("RECURRENCE-ID", "30", "09"), stamp("DTSTART", "30", "09"), stamp("DTEND", "31", "10"), "SUMMARY:Cancelled", "STATUS:CANCELLED");
      const before = ["BEGIN:VCALENDAR", "VERSION:2.0", child, master, cancelled, "END:VCALENDAR", ""].join("\r\n");
      const ref = { externalEventId: collection + "family.ics", etag: '"before"', icalUid: "family" };
      const [first, ...rest] = normalizeCaldavResource({ url: ref.externalEventId, etag: ref.etag, data: before });
      const id = randomUUID();
      const event = (raw: typeof first, index: number) => EventSchema.parse({ ...raw, id: index ? randomUUID() : id, seriesID: index ? id : null, revision: 1, creatorID: "fixture", organizer: "fixture@example.test", color: "red", calendars: ["calendar"], originCalendarID: "calendar" });
      const baseline = { ref, master: event(first!, 0), children: rest.map((item, index) => event(item, index + 1)) };
      const evidence = caldavSeriesEvidence(before, baseline);
      const write = prepareCaldavSeriesWrite(evidence, baseline, { title: "Renamed", description: "New description", location: "New location" });
      assert.ok(write.after.includes(child) && write.after.includes(cancelled));
      assert.ok(write.after.includes("X-PRIVATE;LANGUAGE=cs:Folded\r\n extension"));
      assert.ok(write.after.includes("DESCRIPTION:Keep alarm"));
      const deliver = () => deliverCaldavSeriesResource(collection, write, "Basic Zml4dHVyZTpmaXh0dXJl", AbortSignal.timeout(5000));
      const reset = (nextMode = "ok") => { createData = null; createPuts = 0; missing = false; deletes = 0; data = before; etag = ref.etag; mode = nextMode; puts = gets = 0; };
      reset();
      const confirmed = await deliver();
      assert.equal(puts, 1); assert.equal(gets, 2); assert.equal(putEtag, ref.etag); assert.equal(putBody, write.after);
      assert.equal(confirmed.ref.etag, '"after"'); assert.equal(confirmed.master.title, "Renamed");
      assert.deepEqual(confirmed.exceptions.map(item => [item.title, item.timeModel, item.isCanceled]), evidence.exceptions.map(item => [item.title, item.timeModel, item.isCanceled]));
      await deliver(); assert.equal(puts, 1, "Repeated delivery recovers full desired resource without another PUT");
      const cut = baseline.children.find(item => item.isCanceled)!;
      const followingDelete = { originalStart: cut.originalStart!, expectedOccurrenceRevision: cut.revision! };
      const truncated = prepareCaldavSeriesWrite(evidence, baseline, {}, undefined, undefined, undefined, undefined, followingDelete);
      assert.ok(truncated.after.includes(child), "Earlier original identity survives even when its actual time is after the cut");
      assert.ok(!truncated.after.includes(cancelled));
      assert.ok(truncated.after.includes(master.replace("COUNT=4", "COUNT=2")), "Only RRULE changes in the master, preserving alarms and folded extensions");
      const untilBefore = before.replace("COUNT=4", "UNTIL=" + (kind === "all-day" ? "20260331" : kind === "floating" ? "20260331T090000" : "20260331T070000Z"));
      const untilRaw = normalizeCaldavResource({ url: ref.externalEventId, etag: ref.etag, data: untilBefore })[0]!;
      const untilBaseline = { ...baseline, master: EventSchema.parse({ ...baseline.master, recurrence: untilRaw.recurrence }) };
      const untilWrite = prepareCaldavSeriesWrite(caldavSeriesEvidence(untilBefore, untilBaseline), untilBaseline, {}, undefined, undefined, undefined, undefined, followingDelete);
      assert.ok(untilWrite.after.includes(master.replace("COUNT=4", "COUNT=2")) && untilWrite.after.includes(child) && !untilWrite.after.includes(cancelled));
      const initialStart = kind === "all-day" ? { kind: "date", value: "2026-03-28" } : kind === "floating" ? { kind: "floating", value: "2026-03-28T09:00:00.000" } : { kind: "instant", value: "2026-03-28T08:00:00.000Z" };
      assert.throws(() => prepareCaldavSeriesWrite(evidence, baseline, {}, undefined, undefined, undefined, undefined, { originalStart: initialStart as OccurrenceStart, expectedOccurrenceRevision: null }), "The first slot requires whole-resource DELETE");
      const truncate = () => deliverCaldavSeriesResource(collection, JSON.parse(JSON.stringify(truncated)), "Basic Zml4dHVyZTpmaXh0dXJl", AbortSignal.timeout(5000));
      for (const failure of ["ok", "lost", "applied-503", "race"]) {
        reset(failure);
        if (failure === "race") { await assert.rejects(truncate, (error: any) => error.code === "provider-conflict"); assert.ok(data.includes("SUMMARY:Concurrent child")); }
        else {
          if (failure !== "ok") { await assert.rejects(truncate, (error: any) => error.outcome === "unconfirmed"); mode = "ok"; }
          const result = await truncate(); assert.equal(result.exceptions.length, 1); assert.equal(result.exceptions[0]!.title, "Moved");
          await truncate();
        }
        assert.equal(puts, 1);
      }
      assert.throws(() => prepareCaldavSeriesWrite(evidence, baseline, { title: "Mixed intent" }, undefined, undefined, undefined, undefined, followingDelete));
      assert.throws(() => prepareCaldavSeriesWrite(evidence, baseline, {}, undefined, undefined, undefined, undefined, { ...followingDelete, expectedOccurrenceRevision: 999 }));
      const splitCut = baseline.children.find(item => !item.isCanceled)!;
      const splitRequest = { operationID: randomUUID(), scope: "following", action: "update", expectedRevision: baseline.master.revision, originalStart: splitCut.originalStart, expectedOccurrenceRevision: splitCut.revision, patch: { title: "Future series" } };
      const split = prepareCaldavSeriesSplit(evidence, baseline, splitRequest);
      assert.ok(split.source.after.includes("COUNT=1")); assert.ok(!split.source.after.includes(child) && !split.source.after.includes(cancelled));
      assert.equal(split.creation.children.length, 2); assert.equal(split.creation.ref.etag, undefined);
      assert.ok(split.creation.data.includes(child.replace("UID:family", "UID:" + split.creation.master.id)) && split.creation.data.includes(cancelled.replace("UID:family", "UID:" + split.creation.master.id)));
      for (const recurrence of ["FREQ=DAILY;COUNT=5", "FREQ=DAILY;INTERVAL=1;COUNT=5", "RRULE:FREQ=DAILY;COUNT=5"]) {
        const changedRule = prepareCaldavSeriesSplit(evidence, baseline, { ...splitRequest, patch: { recurrence } });
        assert.ok(changedRule.creation.master.recurrence!.startsWith("RRULE:"));
        assert.equal(changedRule.creation.children.length, 2);
      }
      const untilSplit = prepareCaldavSeriesSplit(caldavSeriesEvidence(untilBefore, untilBaseline), untilBaseline, splitRequest);
      assert.ok(untilSplit.creation.master.recurrence!.includes("UNTIL="));
      const splitTime = kind === "all-day" ? { kind: "all-day", startDate: "2026-04-02", endDate: "2026-04-03" } : { kind, ...(kind === "zoned" ? { timeZone: "Europe/Prague" } : {}), startLocal: "2026-04-02T12:00:00.000", endLocal: "2026-04-03T13:00:00.000" };
      const movedSplit = prepareCaldavSeriesSplit(evidence, baseline, { ...splitRequest, time: splitTime });
      for (const child of movedSplit.creation.children) {
        const old = baseline.children.find(item => item.id === child.id)!;
        assert.deepEqual(child.timeModel, old.timeModel); assert.equal(child.title, old.title); assert.equal(child.isCanceled, old.isCanceled);
        assert.notDeepEqual(child.originalStart, old.originalStart);
      }
      createPath = new URL(split.creation.ref.externalEventId).pathname;
      const create = () => createCaldavSplitResource(collection, JSON.parse(JSON.stringify(split)), "Basic Zml4dHVyZTpmaXh0dXJl", AbortSignal.timeout(5000));
      for (const failure of ["ok", "lost", "applied-503", "create-unreadable", "create-weak", "create-race", "changed-after-put"]) {
        reset(failure);
        if (failure === "create-race") { await assert.rejects(create, (error: any) => error.code === "provider-conflict"); assert.equal(createData, "Foreign resource"); }
        else if (failure === "changed-after-put") { await assert.rejects(create, (error: any) => error.outcome === "unconfirmed"); mode = "ok"; await assert.rejects(create); }
        else {
          if (failure !== "ok") { await assert.rejects(create, (error: any) => error.outcome === "unconfirmed"); mode = "ok"; }
          const result = await create(); assert.equal(result.ref.etag, '"created"'); assert.equal(result.master.title, "Future series"); assert.equal(result.exceptions.length, 2); await create();
        }
        assert.equal(createPuts, 1); assert.equal(data, before); assert.equal(puts, 0, "Creating the new resource never silently truncates the old one");
      }
      reset(); createData = split.creation.data.replace("Future series", "Other series"); await assert.rejects(create); assert.equal(createPuts, 0);
      reset(); await assert.rejects(() => createCaldavSplitResource(collection, { ...split, creation: { ...split.creation, data: split.creation.data.replace("Keep alarm", "Tampered alarm") } }, "Basic Zml4dHVyZTpmaXh0dXJl")); assert.equal(createPuts, 0);
      reset(); await assert.rejects(() => createCaldavSplitResource(collection, split, "Basic Zml4dHVyZTpmaXh0dXJl", undefined, async () => { throw new Error("Authority changed"); }), /Authority changed/); assert.equal(createPuts, 0);
      reset(); config.api.eventTimeEditsEnabled = false; await assert.rejects(create); assert.equal(createPuts, 0); config.api.eventTimeEditsEnabled = true;
      assert.throws(() => prepareCaldavSeriesSplit(evidence, baseline, { ...splitRequest, patch: { url: "https://example.test" } }));
      assert.throws(() => prepareCaldavSeriesSplit(evidence, baseline, { ...splitRequest, originalStart: initialStart, expectedOccurrenceRevision: null }));
      const deletion = prepareCaldavSeriesDeletion(evidence, baseline);
      const remove = () => deleteCaldavSeriesResource(collection, JSON.parse(JSON.stringify(deletion)), "Basic Zml4dHVyZTpmaXh0dXJl", AbortSignal.timeout(5000));
      for (const failure of ["ok", "lost", "applied-503", "delete-unreadable", "delete-race", "delete-recreated"]) {
        reset(failure);
        if (failure === "ok") await remove();
        else if (failure === "delete-race") { await assert.rejects(remove, (error: any) => error.code === "provider-conflict"); assert.ok(data.includes("SUMMARY:Concurrent child")); assert.equal(missing, false); }
        else if (failure === "delete-recreated") { await assert.rejects(remove, (error: any) => error.outcome === "unconfirmed"); mode = "ok"; await assert.rejects(remove, (error: any) => error.code === "provider-conflict"); assert.ok(data.includes("SUMMARY:Recreated")); }
        else { await assert.rejects(remove, (error: any) => error.outcome === "unconfirmed"); mode = "ok"; await remove(); }
        assert.equal(deletes, 1);
        if (missing) { await remove(); assert.equal(deletes, 1, "A complete 404 recovery never repeats DELETE"); }
      }
      reset("ok"); missing = true; await remove(); assert.equal(deletes, 0);
      reset("ok"); etag = '"stale"'; await assert.rejects(remove); assert.equal(deletes, 0);
      reset("ok"); data = data.replace("Keep alarm", "Changed alarm"); await assert.rejects(remove); assert.equal(deletes, 0);
      reset("ok");
      await assert.rejects(() => deleteCaldavSeriesResource(collection, deletion, "Basic Zml4dHVyZTpmaXh0dXJl", AbortSignal.timeout(5000), async () => { throw new Error("Authority changed"); }), /Authority changed/);
      assert.equal(deletes, 0);
      reset("ok"); config.api.eventTimeEditsEnabled = false; await assert.rejects(remove); assert.equal(gets, 0); config.api.eventTimeEditsEnabled = true;
      reset("ok");
      const movedID = baseline.children.find(item => !item.isCanceled)!.id;
      const occurrenceWrite = prepareCaldavSeriesWrite(evidence, baseline, { title: "Only this occurrence", description: "Line one\nLine two", location: null }, movedID);
      assert.ok(occurrenceWrite.after.includes(master) && occurrenceWrite.after.includes(cancelled));
      assert.throws(() => prepareCaldavSeriesWrite(evidence, baseline, { title: "No" }, randomUUID()));
      assert.throws(() => prepareCaldavSeriesWrite(evidence, baseline, {}, baseline.children.find(item => item.isCanceled)!.id, true));
      reset();
      const occurrenceResult = await deliverCaldavSeriesResource(collection, occurrenceWrite, "Basic Zml4dHVyZTpmaXh0dXJl", AbortSignal.timeout(5000));
      assert.equal(occurrenceResult.master.title, "Master");
      assert.equal(occurrenceResult.exceptions.find(item => !item.isCanceled)!.title, "Only this occurrence");
      await deliverCaldavSeriesResource(collection, occurrenceWrite, "Basic Zml4dHVyZTpmaXh0dXJl", AbortSignal.timeout(5000));
      assert.equal(puts, 1, "Occurrence retry recognizes the complete desired family");
      const cancellationWrite = prepareCaldavSeriesWrite(evidence, baseline, {}, movedID, true);
      assert.ok(cancellationWrite.after.includes(master) && cancellationWrite.after.includes(cancelled));
      assert.throws(() => prepareCaldavSeriesWrite(evidence, baseline, {}, undefined, true));
      assert.throws(() => prepareCaldavSeriesWrite(evidence, baseline, { title: "Mixed" }, movedID, true));
      reset("applied-503");
      const cancel = () => deliverCaldavSeriesResource(collection, cancellationWrite, "Basic Zml4dHVyZTpmaXh0dXJl", AbortSignal.timeout(5000));
      await assert.rejects(cancel, (error: any) => error.outcome === "unconfirmed");
      mode = "ok";
      const cancelledResult = await cancel();
      assert.equal(cancelledResult.master.title, "Master");
      assert.ok(cancelledResult.exceptions.every(item => item.isCanceled));
      assert.deepEqual(cancelledResult.exceptions.map(item => item.timeModel), evidence.exceptions.map(item => item.timeModel));
      assert.equal(puts, 1, "Cancellation recovers an applied 503 without another PUT");
      const time = kind === "all-day" ? { kind: "all-day" as const, startDate: "2026-04-02", endDate: "2026-04-03" } : { kind: kind === "floating" ? "floating" as const : "zoned" as const, ...(kind === "zoned" ? { timeZone: "Europe/Prague" } : {}), startLocal: "2026-04-02T12:00:00.000", endLocal: "2026-04-02T13:00:00.000" };
      const timeWrite = prepareCaldavSeriesWrite(evidence, baseline, {}, movedID, undefined, undefined, time as any);
      assert.ok(timeWrite.after.includes(master) && timeWrite.after.includes(cancelled));
      assert.throws(() => prepareCaldavSeriesWrite(evidence, baseline, {}, movedID, true, undefined, time as any));
      assert.throws(() => prepareCaldavSeriesWrite(evidence, baseline, {}, movedID, undefined, undefined, { kind: "zoned", timeZone: "America/New_York", startLocal: "2026-04-02T12:00:00.000", endLocal: "2026-04-02T13:00:00.000" }));
      reset("applied-503");
      const deliverTime = () => deliverCaldavSeriesResource(collection, JSON.parse(JSON.stringify(timeWrite)), "Basic Zml4dHVyZTpmaXh0dXJl", AbortSignal.timeout(5000));
      await assert.rejects(deliverTime, (error: any) => error.outcome === "unconfirmed"); mode = "ok";
      const movedResult = await deliverTime();
      const observedTime = movedResult.exceptions.find(item => !item.isCanceled)!;
      assert.deepEqual(observedTime.originalStart, baseline.children.find(item => item.id === movedID)!.originalStart);
      assert.deepEqual(observedTime.timeModel, resolveEventTimeEdit(time).timeModel);
      assert.equal(observedTime.start.getTime(), resolveEventTimeEdit(time).start.getTime());
      assert.equal(observedTime.end.getTime(), resolveEventTimeEdit(time).end.getTime());
      await deliverTime(); assert.equal(puts, 1);
      if (kind === "zoned") {
        const utcMaster = master.replace(stamp("DTSTART", "28", "09"), "DTSTART:20260328T070000Z").replace(stamp("DTEND", "29", "10"), "DTEND:20260329T080000Z");
        const utcBefore = before.replace(master, utcMaster).split("RECURRENCE-ID;TZID=Europe/Prague:").join("RECURRENCE-ID;TZID=Europe/Prague;X-IDENTITY=keep:");
        const [utcFirst, ...utcRest] = normalizeCaldavResource({ url: ref.externalEventId, etag: ref.etag, data: utcBefore });
        const utcBaseline = { ref, master: event(utcFirst, 0), children: utcRest.map((item, index) => event(item, index + 1)) };
        const utcTime = { kind: "zoned" as const, timeZone: "UTC", startLocal: "2026-04-02T07:00:00.000", endLocal: "2026-04-03T08:00:00.000" };
        const utcWrite = prepareCaldavSeriesWrite(caldavSeriesEvidence(utcBefore, utcBaseline), utcBaseline, {}, undefined, undefined, undefined, utcTime);
        assert.ok(!/RECURRENCE-ID[^\r\n]*TZID/i.test(utcWrite.after));
        assert.match(utcWrite.after, /RECURRENCE-ID;X-IDENTITY=keep:20260403T070000Z/i);
        reset("applied-503"); data = utcBefore;
        const deliverUtc = () => deliverCaldavSeriesResource(collection, JSON.parse(JSON.stringify(utcWrite)), "Basic Zml4dHVyZTpmaXh0dXJl", AbortSignal.timeout(5000));
        await assert.rejects(deliverUtc, (error: any) => error.outcome === "unconfirmed"); mode = "ok";
        const utcResult = await deliverUtc();
        assert.deepEqual(utcResult.exceptions.map(item => item.timeModel), utcRest.map(item => item.timeModel));
        await deliverUtc(); assert.equal(puts, 1);
      }
      const seriesTime = prepareCaldavSeriesWrite(evidence, baseline, {}, undefined, undefined, undefined, time as any);
      reset("applied-503");
      const deliverSeriesTime = () => deliverCaldavSeriesResource(collection, JSON.parse(JSON.stringify(seriesTime)), "Basic Zml4dHVyZTpmaXh0dXJl", AbortSignal.timeout(5000));
      await assert.rejects(deliverSeriesTime, (error: any) => error.outcome === "unconfirmed"); mode = "ok";
      const shifted = await deliverSeriesTime();
      assert.deepEqual(shifted.master.timeModel, resolveEventTimeEdit(time).timeModel);
      const plan = planEventScope(baseline.master, baseline.children, { operationID: randomUUID(), scope: "series", action: "update", expectedRevision: baseline.master.revision!, patch: {}, time });
      for (const [index, previous] of evidence.exceptions.entries()) {
        const next = shifted.exceptions[index]!;
        assert.deepEqual(next.timeModel, previous.timeModel); assert.equal(next.title, previous.title); assert.equal(next.isCanceled, previous.isCanceled);
        const expected = plan.updates.find(item => item.id === baseline.children[index]!.id)!;
        assert.deepEqual(next.originalStart, expected.originalStart);
      }
      await deliverSeriesTime(); assert.equal(puts, 1);
      for (const recurrence of ["FREQ=DAILY;COUNT=5", "RRULE:FREQ=DAILY;INTERVAL=1;COUNT=5", "RRULE:FREQ=DAILY;COUNT=5", kind === "all-day" ? "RRULE:FREQ=DAILY;UNTIL=20260403" : kind === "floating" ? "RRULE:FREQ=DAILY;UNTIL=20260403T090000" : "RRULE:FREQ=DAILY;UNTIL=20260403T070000Z"]) {
        const recurrenceWrite = prepareCaldavSeriesWrite(evidence, baseline, { recurrence });
        assert.ok(recurrenceWrite.after.includes(child) && recurrenceWrite.after.includes(cancelled));
        reset("applied-503");
        const deliverRecurrence = () => deliverCaldavSeriesResource(collection, JSON.parse(JSON.stringify(recurrenceWrite)), "Basic Zml4dHVyZTpmaXh0dXJl", AbortSignal.timeout(5000));
        await assert.rejects(deliverRecurrence, (error: any) => error.outcome === "unconfirmed"); mode = "ok";
        const repeated = await deliverRecurrence();
        assert.equal(repeated.master.recurrence, recurrenceWrite.patch.recurrence);
        assert.deepEqual(repeated.exceptions, evidence.exceptions.map(item => ({ ...item, etag: repeated.ref.etag })));
        await deliverRecurrence(); assert.equal(puts, 1);
      }
      if (kind === "zoned") {
        const alone = before.replace(child + "\r\n", "").replace(cancelled + "\r\n", "");
        const aloneBaseline = { ...baseline, children: [] };
        for (const recurrence of ["FREQ=WEEKLY;BYDAY=SA;COUNT=5", "FREQ=MONTHLY;BYMONTHDAY=28;COUNT=5"]) {
          const prepared = prepareCaldavSeriesWrite(caldavSeriesEvidence(alone, aloneBaseline), aloneBaseline, { recurrence });
          reset("ok"); data = alone;
          const result = await deliverCaldavSeriesResource(collection, prepared, "Basic Zml4dHVyZTpmaXh0dXJl", AbortSignal.timeout(5000));
          assert.equal(result.master.recurrence, prepared.patch.recurrence); assert.equal(result.exceptions.length, 0); assert.equal(puts, 1);
        }
      }
      for (const recurrence of [null, "RRULE:FREQ=DAILY;COUNT=2", "FREQ=DAILY;COUNT=5;COUNT=6", "FREQ=DAILY;COUNT=5;X-UNKNOWN=1", "RRULE:FREQ=DAILY;COUNT=5\nRDATE:20260410T070000Z"]) assert.throws(() => prepareCaldavSeriesWrite(evidence, baseline, { recurrence }));
      assert.throws(() => prepareCaldavSeriesWrite(evidence, baseline, { recurrence: "RRULE:FREQ=DAILY;COUNT=5" }, movedID));
      const revival = prepareCaldavSeriesWrite(evidence, baseline, { title: "Restored occurrence" }, baseline.children.find(item => item.isCanceled)!.id);
      assert.ok(revival.after.includes(master) && revival.after.includes(child));
      assert.ok(revival.after.includes("STATUS:CONFIRMED"));
      reset("applied-503");
      const deliverRevival = () => deliverCaldavSeriesResource(collection, JSON.parse(JSON.stringify(revival)), "Basic Zml4dHVyZTpmaXh0dXJl", AbortSignal.timeout(5000));
      await assert.rejects(deliverRevival, (error: any) => error.outcome === "unconfirmed");
      mode = "ok";
      const restored = await deliverRevival();
      assert.ok(restored.exceptions.every(item => !item.isCanceled));
      assert.deepEqual(restored.exceptions.map(item => item.timeModel), evidence.exceptions.map(item => item.timeModel));
      await deliverRevival(); assert.equal(puts, 1);
      const originalStart: OccurrenceStart = kind === "all-day" ? { kind: "date", value: "2026-03-31" } : kind === "floating" ? { kind: "floating", value: "2026-03-31T09:00:00.000" } : { kind: "instant", value: "2026-03-31T07:00:00.000Z" };
      for (const variant of ["content", "cancel", "time"]) {
        const cancelNew = variant === "cancel";
        const generatedTime = variant === "time" ? time : undefined;
        const definitionID = randomUUID();
        const patch = cancelNew ? {} : { title: "New detached definition", description: "Keep unknown data" };
        const common = { operationID: randomUUID(), expectedRevision: baseline.master.revision!, scope: "occurrence" as const, expectedOccurrenceRevision: null, originalStart };
        const request = cancelNew ? { ...common, action: "delete" as const } : { ...common, action: "update" as const, patch, ensureDefinition: true, time: generatedTime };
        const definition = planEventScope(baseline.master, baseline.children, request, () => definitionID).creates[0]!;
        assert.ok(definition);
        const generatedWrite = prepareCaldavSeriesWrite(evidence, baseline, patch, definitionID, cancelNew ? true : undefined, definition, generatedTime as any);
        assert.ok(generatedWrite.after.includes(master) && generatedWrite.after.includes(child) && generatedWrite.after.includes(cancelled));
        assert.equal(generatedWrite.after.split("X-PRIVATE;LANGUAGE=cs:Folded\r\n extension").length, 3, "New definition retains inherited unknown bytes");
        assert.throws(() => prepareCaldavSeriesWrite(evidence, baseline, patch, definitionID, cancelNew ? true : undefined, { ...definition, start: new Date(0) }));
        assert.throws(() => prepareCaldavSeriesWrite(evidence, baseline, patch, definitionID, cancelNew ? true : undefined, { ...definition, originalStart: baseline.children[0]!.originalStart }));
        reset("applied-503");
        const deliverGenerated = () => deliverCaldavSeriesResource(collection, JSON.parse(JSON.stringify(generatedWrite)), "Basic Zml4dHVyZTpmaXh0dXJl", AbortSignal.timeout(5000));
        await assert.rejects(deliverGenerated, (error: any) => error.outcome === "unconfirmed");
        mode = "ok";
        const generatedResult = await deliverGenerated();
        assert.equal(generatedResult.exceptions.length, evidence.exceptions.length + 1);
        const added = generatedResult.exceptions.find(item => JSON.stringify(item.originalStart) === JSON.stringify(originalStart))!;
        assert.equal(added.isCanceled, cancelNew);
        assert.equal(added.title, cancelNew ? baseline.master.title : patch.title);
        assert.deepEqual(added.timeModel, definition.timeModel);
        assert.equal(added.start.getTime(), definition.start.getTime());
        assert.equal(added.end.getTime(), definition.end.getTime());
        await deliverGenerated(); assert.equal(puts, 1, "Generated definition replay never appends a second VEVENT or repeats PUT");
      }
      for (const failure of ["lost", "applied-503"]) {
        reset(failure);
        await assert.rejects(deliver, (error: any) => error.outcome === "unconfirmed");
        mode = "ok";
        assert.equal((await deliver()).ref.etag, '"after"');
        assert.equal(puts, 1, "Applied ambiguous writes must not be repeated");
      }
      reset("retry-baseline");
      await assert.rejects(deliver, (error: any) => error.outcome === "unconfirmed");
      mode = "ok"; await deliver(); assert.equal(puts, 2); assert.equal(putEtag, ref.etag);
      reset("race");
      await assert.rejects(deliver, (error: any) => error.code === "provider-conflict" && error.providerStatus === 412 && error.outcome === "not-written");
      assert.ok(data.includes("SUMMARY:Concurrent child")); assert.equal(puts, 1);
      mode = "ok"; await assert.rejects(deliver, /conflict/); assert.equal(puts, 1);
      reset(); etag = '"new-validator-same-content"';
      await assert.rejects(deliver, /conflict/); assert.equal(puts, 0, "A newer baseline must never silently rebase the intent");
      for (const replacement of [before.replace("SUMMARY:Moved", "SUMMARY:Other"), before.replace("DESCRIPTION:Keep alarm", "DESCRIPTION:Other"), before.replace("Folded", "Changed")]) {
        reset(); data = replacement;
        await assert.rejects(deliver, /conflict/); assert.equal(puts, 0, "Full baseline content is checked even if a broken server reuses its ETag");
      }
      reset("changed-after-put");
      await assert.rejects(deliver, (error: any) => error.code === "provider-conflict" && error.outcome === "unconfirmed");
      mode = "ok"; await assert.rejects(deliver, /conflict/); assert.equal(puts, 1, "Matching projected fields cannot hide changed alarms on recovery");
      for (const refusal of ["redirect-get", "weak", "partial", "invalid-utf8"]) {
        reset(refusal); await assert.rejects(deliver); assert.equal(puts, 0); assert.equal(gets, 1);
      }
      reset("redirect-put"); await assert.rejects(deliver); assert.equal(puts, 1, "PUT redirect is never followed");
      for (const patch of [{ start: new Date() }, { recurrence: null }, { timeModel: null }, { url: "https://example.test" }, { title: 123 }])
        assert.throws(() => prepareCaldavSeriesWrite(evidence, baseline, patch as any));
      reset();
      await assert.rejects(() => deliverCaldavSeriesResource(collection, { ...write, after: write.after.replace("SUMMARY:Moved", "SUMMARY:Injected") }, "fixture"));
      assert.equal(gets + puts, 0, "Tampered persisted replacement is rejected before network I/O");
      const reordered = write.after.replace("VERSION:2.0\r\n", "").replace("BEGIN:VCALENDAR\r\n", "BEGIN:VCALENDAR\nVERSION:2.0\n").replace("Folded\r\n extension", "Foldedextension");
      assert.ok(sameCaldavResource(write.after, reordered));
      assert.equal(sameCaldavResource(write.after, write.after.replace("Folded", "Other")), false);
      reset(); data = reordered; etag = '"canonicalized"';
      assert.equal((await deliver()).ref.etag, etag); assert.equal(puts, 0);
      for (const [left, right] of [["X-NUM;VALUE=INTEGER:001", "X-NUM;VALUE=INTEGER:1"], ["X-NUM;VALUE=INTEGER:bad", "X-NUM;VALUE=INTEGER:worse"], ["X-PRIVATE;LANGUAGE=cs;X-PARAM=a:Value", "X-PRIVATE;X-PARAM=a;LANGUAGE=cs:Value"]]) {
        assert.equal(sameCaldavResource(write.after.replace("VERSION:2.0", "VERSION:2.0\r\n" + left), write.after.replace("VERSION:2.0", "VERSION:2.0\r\n" + right)), false, "Typed parser coercion must not erase unknown raw-value changes");
      }
      config.api.eventTimeEditsEnabled = false;
      reset(); await assert.rejects(deliver); assert.equal(puts + gets, 0);
      config.api.eventTimeEditsEnabled = true;
      const noop = prepareCaldavSeriesWrite(evidence, baseline, {});
      reset(); await deliverCaldavSeriesResource(collection, noop, "fixture"); assert.equal(puts, 0);
    }
    console.log("CalDAV series HTTP delivery: preserved family, CAS, full-resource recovery and refusals OK");
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
