import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { EventSchema } from "@musubi/types";
import { normalizeCaldavResource } from "./caldav_time";

process.env.DATABASE_URL ??= "postgres://user:pass@localhost:5432/test";
process.env.ENVIRONMENT ??= "test";
process.env.BETTER_AUTH_URL ??= "http://localhost:7531";
async function main() {
const { caldavSeriesEvidence, caldavSeriesResourceURL } = await import("./caldav_series");
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
