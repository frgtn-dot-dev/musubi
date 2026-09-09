import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { EventSchema } from "@musubi/types";
import { normalizeCaldavResource } from "./caldav_time";

process.env.DATABASE_URL ??= "postgres://user:pass@localhost:5432/test";
process.env.ENVIRONMENT ??= "test";
process.env.BETTER_AUTH_URL ??= "http://localhost:7531";
async function main() {
  const { prepareCaldavSeriesWrite } = await import("./caldav");
  const { caldavSeriesEvidence } = await import("./caldav_series");
  const { caldavSeriesDesired } = await import("@musubi/db");
  const zone = ["BEGIN:VTIMEZONE", "TZID:Europe/Prague", "BEGIN:DAYLIGHT", "DTSTART:19700329T020000", "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU", "TZOFFSETFROM:+0100", "TZOFFSETTO:+0200", "END:DAYLIGHT", "BEGIN:STANDARD", "DTSTART:19701025T030000", "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU", "TZOFFSETFROM:+0200", "TZOFFSETTO:+0100", "END:STANDARD", "END:VTIMEZONE"].join("\r\n");
  const raw = ["BEGIN:VCALENDAR", "VERSION:2.0", zone, "BEGIN:VEVENT", "UID:zone-proof", "DTSTART;TZID=Europe/Prague:20260328T090000", "DTEND;TZID=Europe/Prague:20260328T100000", "RRULE:FREQ=DAILY;COUNT=4", "SUMMARY:Clock time", "X-PRIVATE;LANGUAGE=cs:Keep folded", " bytes", "BEGIN:VALARM", "ACTION:DISPLAY", "TRIGGER:-PT15M", "DESCRIPTION:Private alarm", "END:VALARM", "END:VEVENT", "END:VCALENDAR", ""].join("\r\n");
  const ref = { externalEventId: "https://dav.example/calendar/zone.ics", etag: '"before"', icalUid: "zone-proof" };
  const [parsed] = normalizeCaldavResource({ ...ref, url: ref.externalEventId, data: raw });
  const master = EventSchema.parse({ ...parsed, id: randomUUID(), revision: 1, creatorID: "owner", organizer: "", color: "red", calendars: ["calendar"], originCalendarID: "calendar" });
  const baseline = { ref, master, children: [] };
  const time = { kind: "zoned" as const, timeZone: "UTC", startLocal: "2026-03-28T09:00:00.000", endLocal: "2026-03-28T10:00:00.000" };
  const prepare = (data: string) => prepareCaldavSeriesWrite(caldavSeriesEvidence(data, baseline), baseline, {}, undefined, undefined, undefined, time);
  const saved = prepare(raw);
  assert.equal(saved.after, raw.replace("DTSTART;TZID=Europe/Prague:20260328T090000", "DTSTART:20260328T090000Z").replace("DTEND;TZID=Europe/Prague:20260328T100000", "DTEND:20260328T100000Z"));
  assert.deepEqual(saved.time, time);
  assert.deepEqual(caldavSeriesDesired(JSON.parse(JSON.stringify(saved))), caldavSeriesDesired(saved));
  assert.equal(caldavSeriesDesired(saved).master.timeModel?.kind, "zoned");
  assert.throws(() => prepare(raw.replace("TZOFFSETTO:+0200", "TZOFFSETTO:+0300")));
  for (const extra of [{ patch: { title: "Concurrent content" } }, { baseline: { ...baseline, children: [master] } }, { targetEventID: master.id }, { time: { ...time, timeZone: "Europe/London" } }]) assert.throws(() => caldavSeriesDesired({ ...saved, ...extra }));
  console.log("CalDAV UTC serializer: exact resource preservation, embedded DST proof and private intent gates: OK");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
