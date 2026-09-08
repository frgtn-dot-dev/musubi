import assert from "node:assert/strict";
import { normalizeCaldavResource } from "./caldav_time";

const component = (...lines: string[]) => ["BEGIN:VEVENT", "UID:family", ...lines, "END:VEVENT"].join("\r\n");
const resource = (...components: string[]) => ({ url: "https://dav.example.test/calendar/family.ics", etag: '"v1"', data: ["BEGIN:VCALENDAR", "VERSION:2.0", ...components, "END:VCALENDAR"].join("\r\n") });
const master = component("DTSTART;TZID=Europe/Prague:20260328T090000", "DTEND;TZID=Europe/Prague:20260328T100000", "RRULE:FREQ=DAILY;COUNT=4", "SUMMARY:Master", "X-PRIVATE:preserved", "BEGIN:VALARM", "ACTION:DISPLAY", "TRIGGER:-PT15M", "DESCRIPTION:Reminder", "END:VALARM");
const moved = component("RECURRENCE-ID;TZID=Europe/Prague:20260329T090000", "DTSTART;TZID=Europe/Prague:20260329T140000", "DTEND;TZID=Europe/Prague:20260329T160000", "SUMMARY:Moved");
const cancelled = component("RECURRENCE-ID;TZID=Europe/Prague:20260330T090000", "DTSTART;TZID=Europe/Prague:20260330T090000", "DURATION:PT1H", "STATUS:CANCELLED");
const input = resource(moved, cancelled, master);
const untouched = structuredClone(input);
const parsed = normalizeCaldavResource(input);
assert.deepEqual(input, untouched);
assert.equal(parsed[0]!.title, "Master");
assert.equal(parsed[0]!.recurrence, "RRULE:FREQ=DAILY;COUNT=4");
assert.equal(parsed[1]!.start.toISOString(), "2026-03-29T12:00:00.000Z");
assert.equal(parsed[1]!.end.getTime() - parsed[1]!.start.getTime(), 7200000);
assert.deepEqual(parsed[1]!.originalStart, { kind: "instant", value: "2026-03-29T07:00:00.000Z" });
assert.equal(parsed[2]!.isCanceled, true);
assert.equal(parsed[2]!.status, "active");
assert.deepEqual(normalizeCaldavResource(resource(master, moved, cancelled)), parsed);
for (const [duration, expected] of [["P1D", "2026-03-29T07:00:00.000Z"], ["PT24H", "2026-03-29T08:00:00.000Z"], ["P1DT2H", "2026-03-29T09:00:00.000Z"]]) {
  const [event] = normalizeCaldavResource(resource(component("DTSTART;TZID=Europe/Prague:20260328T090000", `DURATION:${duration}`)));
  assert.equal(event!.end.toISOString(), expected);
}
const [floating] = normalizeCaldavResource(resource(component("DTSTART:20260329T090000", "DURATION:PT1H")));
assert.equal(floating!.timeModel!.kind, "floating");
assert.equal(floating!.start.toISOString(), "2026-03-29T09:00:00.000Z");
const [allDay] = normalizeCaldavResource(resource(component("DTSTART;VALUE=DATE:20260329")));
assert.equal(allDay!.start.toISOString(), allDay!.end.toISOString());
for (const invalid of [resource(moved), resource(master, master), resource(master, moved, moved), resource(master, moved.replace("UID:family", "UID:other")), resource(master.replace("Europe/Prague", "Custom/Unsupported")), resource(master, moved.replace("RECURRENCE-ID;", "RECURRENCE-ID;RANGE=THISANDFUTURE;"))]) assert.throws(() => normalizeCaldavResource(invalid));
console.log("CalDAV component identity, content, cancellation and civil duration: OK");

for (const endpoint of ["DURATION:PT3H", "DTEND:20261025T013000Z"]) {
  const [event] = normalizeCaldavResource(resource(component("DTSTART;TZID=Europe/Prague:20261025T003000", endpoint)));
  assert.equal(event!.end.toISOString(), "2026-10-25T01:30:00.000Z");
  assert.equal(event!.end.getTime() - event!.start.getTime(), 3 * 3600000);
}

assert.throws(() => normalizeCaldavResource(resource(component("DTSTART;TZID=Europe/Prague:20260328T090000", "DURATION:P1D", "RRULE:FREQ=DAILY;COUNT=3"))), /nominal-day/);
