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
  const { prepareCaldavSeriesWrite, deliverCaldavSeriesResource } = await import("./caldav");
  const { caldavSeriesEvidence, sameCaldavResource } = await import("./caldav_series");
  let data = "", etag = '"before"', mode = "ok", puts = 0, gets = 0;
  let putBody = "", putEtag: string | undefined;
  const server = createServer(async (req, res) => {
    if (req.method === "GET") {
      gets++;
      if (mode === "redirect-get") { res.writeHead(302, { location: "/collection/other.ics" }); res.end(); return; }
      res.writeHead(mode === "partial" ? 206 : 200, { "content-type": "text/calendar", etag: mode === "weak" ? 'W/"weak"' : etag, ...(mode === "partial" ? { "content-range": "bytes 0-5/1000" } : {}) });
      res.end(mode === "invalid-utf8" ? Buffer.from([0xc3, 0x28]) : data);
      return;
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
      const reset = (nextMode = "ok") => { data = before; etag = ref.etag; mode = nextMode; puts = gets = 0; };
      reset();
      const confirmed = await deliver();
      assert.equal(puts, 1); assert.equal(gets, 2); assert.equal(putEtag, ref.etag); assert.equal(putBody, write.after);
      assert.equal(confirmed.ref.etag, '"after"'); assert.equal(confirmed.master.title, "Renamed");
      assert.deepEqual(confirmed.exceptions.map(item => [item.title, item.timeModel, item.isCanceled]), evidence.exceptions.map(item => [item.title, item.timeModel, item.isCanceled]));
      await deliver(); assert.equal(puts, 1, "Repeated delivery recovers full desired resource without another PUT");
      const movedID = baseline.children.find(item => !item.isCanceled)!.id;
      const occurrenceWrite = prepareCaldavSeriesWrite(evidence, baseline, { title: "Only this occurrence", description: "Line one\nLine two", location: null }, movedID);
      assert.ok(occurrenceWrite.after.includes(master) && occurrenceWrite.after.includes(cancelled));
      assert.throws(() => prepareCaldavSeriesWrite(evidence, baseline, { title: "No" }, randomUUID()));
      assert.throws(() => prepareCaldavSeriesWrite(evidence, baseline, { title: "No" }, baseline.children.find(item => item.isCanceled)!.id));
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
