import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { EventSchema } from "@musubi/types";
import { normalizeCaldavResource } from "./caldav_time";

process.env.DATABASE_URL ??= "postgres://user:pass@localhost:5432/test";
process.env.ENVIRONMENT ??= "test";
process.env.BETTER_AUTH_URL ??= "http://localhost:7531";
async function main() {
const { caldavSeriesEvidence, caldavSeriesResourceURL, caldavSeriesResolutionEvidence } = await import("./caldav_series");
const collection = "https://dav.example/calendar/";
assert.equal(caldavSeriesResourceURL(collection, collection + "normal%20name.ics").href, collection + "normal%20name.ics");
for (const target of ["..%2Fother%2Ffamily.ics", "..%5cother%5cfamily.ics", "%252e%252e%252fother.ics", "%ZZ", "child.ics#occurrence", "child.ics?projection=1", "nested/child.ics", "%00.ics", "../outside.ics"])
  assert.throws(() => caldavSeriesResourceURL(collection, collection + target));
assert.throws(() => caldavSeriesResourceURL(collection, "https://other.example/calendar/child.ics"));
assert.throws(() => caldavSeriesResourceURL(collection, "https://user:pass@dav.example/calendar/child.ics"));

const component = (...lines: string[]) => ["BEGIN:VEVENT", "UID:family", ...lines, "END:VEVENT"].join("\r\n");
const resource = (...components: string[]) => ["BEGIN:VCALENDAR", "VERSION:2.0", ...components, "END:VCALENDAR", ""].join("\r\n");
for (const kind of ["zoned", "all-day", "floating"]) {
  const stamp = (name: string, day: string, hour: string) => kind === "all-day"
    ? `${name};VALUE=DATE:202603${day}`
    : `${name}${kind === "zoned" ? ";TZID=Europe/Prague" : ""}:202603${day}T${hour}0000`;
  const master = component(stamp("DTSTART", "28", "09"), stamp("DTEND", "29", "10"), "RRULE:FREQ=DAILY;COUNT=4", "SUMMARY:Master", "X-CUSTOM;LANGUAGE=cs:Keep folded", " continuation", "BEGIN:VALARM", "ACTION:DISPLAY", "TRIGGER:-PT15M", "DESCRIPTION:Keep", "END:VALARM");
  const child = component(stamp("RECURRENCE-ID", "29", "09"), stamp("DTSTART", "30", "14"), stamp("DTEND", "31", "16"), "SUMMARY:Custom child");
  const cancelled = component(stamp("RECURRENCE-ID", "30", "09"), stamp("DTSTART", "30", "09"), stamp("DTEND", "31", "10"), "SUMMARY:Cancelled child", "STATUS:CANCELLED");
  const data = resource(child, master, cancelled);
  const ref = { externalEventId: "https://dav.example/calendar/family.ics", etag: '\"resource-v1\"', icalUid: "family" };
  const masterID = randomUUID();
  const [first, ...rest] = normalizeCaldavResource({ url: ref.externalEventId, etag: ref.etag, data });
  const event = (raw: typeof first, index: number) => EventSchema.parse({ ...raw, id: index === 0 ? masterID : randomUUID(), seriesID: index ? masterID : null, revision: 1, creatorID: "fixture", organizer: "fixture@example.test", color: "red", calendars: ["calendar"], originCalendarID: "calendar" });
  const intent = { ref, master: event(first!, 0), children: rest.map((item, index) => event(item, index + 1)) };
  const evidence = caldavSeriesEvidence(data, intent);
  assert.equal(evidence.data, data, "Full GET bytes, folded extensions and nested alarms must remain untouched");
  assert.equal(evidence.master.title, "Master");
  assert.equal(evidence.exceptions.length, 2);
  assert.equal(evidence.exceptions.find(item => item.isCanceled)?.title, "Cancelled child");
  assert.equal(evidence.ref.etag, ref.etag);
  const currentRef = { ...ref, etag: '"resource-v2"' };
  const currentData = data.replace("SUMMARY:Master", "SUMMARY:Remote master\r\nDESCRIPTION:Remote description\r\nLOCATION:Remote location").replace("Keep folded", "Remote extension").replace("DESCRIPTION:Keep", "DESCRIPTION:Remote alarm");
  const observed = caldavSeriesResolutionEvidence(currentData, intent, currentRef, data);
  assert.equal(observed.baseline.master.title, "Remote master");
  assert.equal(observed.baseline.master.description, "Remote description");
  assert.equal(observed.baseline.master.location, "Remote location");
  assert.equal(observed.evidence.data, currentData);
  assert.equal(observed.evidence.ref.etag, currentRef.etag);
  assert.deepEqual(observed.baseline.children, intent.children);
  assert.equal(intent.master.title, "Master", "A read must not replace the saved local draft");
  assert.equal(intent.ref.etag, ref.etag);
  const target = intent.children.find(item => !item.isCanceled)!;
  const remoteChild = data.replace("SUMMARY:Custom child", "SUMMARY:Remote child\r\nDESCRIPTION:Child description\r\nLOCATION:Child location").replace("Keep folded", "Fresh extension");
  const childPreview = caldavSeriesResolutionEvidence(remoteChild, intent, currentRef, data, target.id);
  assert.deepEqual(childPreview.baseline.master, intent.master);
  assert.equal(childPreview.baseline.children.find(item => item.id === target.id)!.title, "Remote child");
  assert.deepEqual(childPreview.baseline.children.find(item => item.id !== target.id), intent.children.find(item => item.id !== target.id));
  assert.equal(childPreview.evidence.data, remoteChild);
  assert.equal(target.title, "Custom child");
  for (const invalidTarget of ["", randomUUID(), intent.master.id, intent.children.find(item => item.isCanceled)!.id])
    assert.throws(() => caldavSeriesResolutionEvidence(remoteChild, intent, currentRef, data, invalidTarget));
  for (const modified of [
    remoteChild.replace("SUMMARY:Master", "SUMMARY:Another master"),
    remoteChild.replace("SUMMARY:Cancelled child", "SUMMARY:Another cancellation"),
    remoteChild.replace(stamp("DTSTART", "30", "14"), stamp("DTSTART", "31", "15")),
    remoteChild.replace(stamp("RECURRENCE-ID", "29", "09"), stamp("RECURRENCE-ID", "31", "09")),
    remoteChild.replace("SUMMARY:Remote child", "STATUS:CANCELLED\r\nSUMMARY:Remote child"),
    remoteChild.replace("SUMMARY:Remote child", "SUMMARY:Remote child\r\nATTENDEE:mailto:guest@example.test"),
  ]) assert.throws(() => caldavSeriesResolutionEvidence(modified, intent, currentRef, data, target.id));
  const privateOnly = data.replace("Keep folded", "Fresh extension");
  const preserved = caldavSeriesResolutionEvidence(privateOnly, intent, currentRef, data, null);
  assert.deepEqual(preserved.baseline.master, intent.master); assert.deepEqual(preserved.baseline.children, intent.children);
  assert.equal(preserved.evidence.data, privateOnly);
  assert.throws(() => caldavSeriesResolutionEvidence(currentData, intent, currentRef, data, null));
  assert.throws(() => caldavSeriesResolutionEvidence(remoteChild, intent, currentRef, data, null));
  const cancelledTarget = intent.children.find(item => item.isCanceled)!;
  const revival = caldavSeriesResolutionEvidence(data.replace("SUMMARY:Cancelled child", "SUMMARY:Fresh cancelled content"), intent, currentRef, data, cancelledTarget.id);
  assert.equal(revival.baseline.children.find(item => item.id === cancelledTarget.id)!.isCanceled, true);
  assert.equal(revival.baseline.children.find(item => item.id === cancelledTarget.id)!.title, "Fresh cancelled content");
  const timezone = ["BEGIN:VTIMEZONE", "TZID:Europe/Prague", "BEGIN:STANDARD", "DTSTART:20261025T030000", "TZOFFSETFROM:+0200", "TZOFFSETTO:+0100", "END:STANDARD", "END:VTIMEZONE"].join("\r\n");
  const withZone = (value: string) => value.replace("VERSION:2.0", "VERSION:2.0\r\n" + timezone);
  assert.equal(caldavSeriesResolutionEvidence(withZone(currentData), intent, currentRef, withZone(data)).evidence.data, withZone(currentData));
  for (const changedZone of [withZone(currentData).replace("TZOFFSETTO:+0100", "TZOFFSETTO:+0300"), withZone(currentData).replace("DTSTART:20261025T030000", "DTSTART:20261018T030000"), currentData])
    assert.throws(() => caldavSeriesResolutionEvidence(changedZone, intent, currentRef, withZone(data)));
  assert.throws(() => caldavSeriesResolutionEvidence(withZone(currentData), intent, currentRef, data));

  for (const modified of [
    currentData.replace("SUMMARY:Custom child", "SUMMARY:Concurrent child"),
    currentData.replace("STATUS:CANCELLED", "STATUS:CONFIRMED"),
    currentData.replace("COUNT=4", "COUNT=5"),
    currentData.replace(stamp("DTSTART", "28", "09"), stamp("DTSTART", "27", "09")),
    currentData.replace("SUMMARY:Remote master", "SUMMARY:Remote master\r\nORGANIZER:mailto:other@example.test"),
    currentData.replace("SUMMARY:Remote master", "SUMMARY:Remote master\r\nSUMMARY:Duplicate"),
    resource(master, child),
  ]) assert.throws(() => caldavSeriesResolutionEvidence(modified, intent, currentRef, data));
  for (const invalid of [{ ...currentRef, etag: 'W/"weak"' }, { ...currentRef, externalEventId: collection + "other.ics" }, { ...currentRef, icalUid: "other" }])
    assert.throws(() => caldavSeriesResolutionEvidence(currentData, intent, invalid, data));

  assert.throws(() => caldavSeriesEvidence(data, { ...intent, children: [] }), /conflict/);
  assert.throws(() => caldavSeriesEvidence(data, { ...intent, children: [...intent.children, intent.children[0]!] }), /conflict/);
  assert.throws(() => caldavSeriesEvidence(data, { ...intent, ref: { ...ref, icalUid: "other" } }), /conflict/);
  assert.throws(() => caldavSeriesEvidence(data, { ...intent, ref: { ...ref, etag: 'W/"weak"' } }));
  for (const modified of [
    data.replace("SUMMARY:Custom child", "SUMMARY:Changed child"),
    data.replace("STATUS:CANCELLED", "STATUS:CONFIRMED"),
    data.replace("SUMMARY:Master", "SUMMARY:Changed master"),
    data.replace("SUMMARY:Custom child", "SUMMARY:Custom child\r\nATTENDEE:mailto:guest@example.test"),
    data.replace("SUMMARY:Master", "SUMMARY:Master\r\nORGANIZER:mailto:owner@example.test"),
    data.replace("SUMMARY:Master", "SUMMARY:Master\r\nSUMMARY:Ambiguous"),
    data.replace("VERSION:2.0", "VERSION:2.0\r\nMETHOD:REQUEST"),
    resource(child, master, cancelled, child),
    resource(child, master, master),
    data + "trailing junk",
  ]) assert.throws(() => caldavSeriesEvidence(modified, intent));
}
console.log("CalDAV complete series evidence: exact resource preservation, civil models, cancellation and refusal OK");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
