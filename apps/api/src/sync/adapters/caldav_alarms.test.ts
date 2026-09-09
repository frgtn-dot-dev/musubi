import assert from "node:assert/strict";
import { EventSchema } from "@musubi/types";
import { normalizeCaldavResource } from "./caldav_time";
process.env.DATABASE_URL ??= "postgres://user:pass@localhost:5432/test";
process.env.ENVIRONMENT ??= "test";
process.env.BETTER_AUTH_URL ??= "http://localhost:7531";
async function main() {
  const { inspectCaldavAlarm, writeCaldavAlarm, withoutCaldavAlarm } = await import("./caldav_alarms");
  const ref = { externalEventId: "https://dav.example/calendar/one.ics", etag: '"one"', icalUid: "one" };
  for (const kind of ["zoned", "all-day", "overnight"]) for (const series of [false, true]) {
    let data = ["BEGIN:VCALENDAR", "VERSION:2.0", "X-CUSTOM:root", "BEGIN:VEVENT", "UID:one", kind !== "all-day" ? "DTSTART;TZID=Europe/Prague:20260329T090000" : "DTSTART;VALUE=DATE:20260329", kind !== "all-day" ? "DTEND;TZID=Europe/Prague:20260329T100000" : "DTEND;VALUE=DATE:20260330", "SUMMARY:One", "X-PRIVATE:untouched", " continuation", "BEGIN:VALARM", "ACTION:DISPLAY", "TRIGGER;RELATED=START:-PT15M", "DESCRIPTION:Private folded", " description", "END:VALARM", "END:VEVENT", "END:VCALENDAR", ""].join("\r\n");
    if (series) data = data.replace("SUMMARY:One", "RRULE:FREQ=DAILY;COUNT=4\r\nSUMMARY:One").replace(/20260329T/g, "20260328T");
    if (kind === "overnight") data = data.replace("T090000", "T230000").replace(series ? "20260328T100000" : "20260329T100000", series ? "20260329T010000" : "20260330T010000");
    const normalized = normalizeCaldavResource({ url: ref.externalEventId, etag: ref.etag, data })[0];
    const event = EventSchema.parse({ ...normalized, id: "00000000-0000-4000-8000-000000000301", revision: 1, creatorID: "fixture", organizer: "", color: "red", calendars: ["calendar"], originCalendarID: "calendar" });
    assert.equal(inspectCaldavAlarm(data, event, ref).alarms.minutesBeforeStart, 15);
    if (series) {
      const { finiteSeriesFootprint, expandRecurringEvents } = await import("@musubi/calendar");
      const footprint = (value: typeof event) => expandRecurringEvents([value], value.start, new Date(value.start.getTime() + 10 * 86400000), { consumerTimeZone: "UTC" });
      const slots = footprint(event);
      if (kind === "overnight") {
        assert.throws(() => finiteSeriesFootprint(event), "Graph keeps its same-civil-day restriction");
        assert.deepEqual(slots.map(slot => slot.start.toISOString()), ["2026-03-28T22:00:00.000Z", "2026-03-29T21:00:00.000Z", "2026-03-30T21:00:00.000Z", "2026-03-31T21:00:00.000Z"]);
        assert.ok(slots.every(slot => slot.end.getTime() - slot.start.getTime() === 2 * 3600000));
        for (const [start, end] of [["20260328T023000", "20260328T033000"], ["20261023T230000", "20261024T023000"]]) {
          const ambiguous = data.replace("20260328T230000", start).replace("20260329T010000", end);
          const parsed = normalizeCaldavResource({ url: ref.externalEventId, etag: ref.etag, data: ambiguous })[0];
          assert.throws(() => inspectCaldavAlarm(ambiguous, EventSchema.parse({ ...event, ...parsed, organizer: "" }), ref), "A skipped start or folded end cannot hide in COUNT");
        }
      }
      assert.equal(slots.length, 4);
      for (const rule of ["FREQ=DAILY", "FREQ=DAILY;UNTIL=20260402", "FREQ=DAILY;COUNT=367", "FREQ=DAILY;COUNT=4;COUNT=4"]) assert.throws(() => inspectCaldavAlarm(data.replace("FREQ=DAILY;COUNT=4", rule), { ...event, recurrence: "RRULE:" + rule }, ref));
      for (const property of ["RDATE;VALUE=DATE:20260401", "EXDATE;VALUE=DATE:20260330", "RECURRENCE-ID;VALUE=DATE:20260330"]) assert.throws(() => inspectCaldavAlarm(data.replace("SUMMARY:One", property + "\r\nSUMMARY:One"), event, ref));
      const changed = writeCaldavAlarm(data, event, ref, { minutesBeforeStart: 30 });
      assert.deepEqual(footprint(EventSchema.parse({ ...event, ...normalizeCaldavResource({ url: ref.externalEventId, etag: ref.etag, data: changed })[0], organizer: "" })), slots);
    }
    assert.equal(writeCaldavAlarm(data, event, ref, { minutesBeforeStart: 15 }), data);
    for (const minutesBeforeStart of [null, 0, 30, 40320]) {
      const after = writeCaldavAlarm(data, event, ref, { minutesBeforeStart });
      assert.equal(withoutCaldavAlarm(after), withoutCaldavAlarm(data));
      assert.equal(inspectCaldavAlarm(after, event, ref).alarms.minutesBeforeStart, minutesBeforeStart);
      if (minutesBeforeStart !== null) assert.ok(after.includes("DESCRIPTION:Private folded\r\n description"));
    }
    const noAlarm = withoutCaldavAlarm(data), added = writeCaldavAlarm(noAlarm, event, ref, { minutesBeforeStart: 20 });
    assert.equal(withoutCaldavAlarm(added), noAlarm); assert.ok(added.includes("DESCRIPTION:Calendar reminder"));
    for (const trigger of ["-P1D", "-P1W", "-PT1S", "PT1M", "20260329T070000Z", "-PT40321M", "-PT999999999999999999H"]) assert.throws(() => inspectCaldavAlarm(data.replace("-PT15M", trigger), event, ref), trigger);
    for (const change of [
      data.replace("ACTION:DISPLAY", "ACTION:EMAIL"), data.replace("ACTION:DISPLAY", "ACTION;VALUE=URI:DISPLAY"), data.replace("TRIGGER;RELATED=START", "TRIGGER;RELATED=START;RELATED=START"), data.replace("RELATED=START", "RELATED=END"),
      data.replace("DESCRIPTION:Private", "REPEAT:2\r\nDURATION:PT5M\r\nDESCRIPTION:Private"),
      data.replace("DESCRIPTION:Private", "X-UNKNOWN:yes\r\nDESCRIPTION:Private"), data.replace("DESCRIPTION:Private", "ACKNOWLEDGED:20260329T070000Z\r\nDESCRIPTION:Private"),
      data.replace("DESCRIPTION:Private", "DESCRIPTION;LANGUAGE=cs:Private"), data.replace("SUMMARY:One", "SUMMARY:One\r\nATTENDEE:mailto:x@example.test"),
      data.replace("SUMMARY:One", "SUMMARY:One\r\nORGANIZER:mailto:x@example.test"), data.replace("SUMMARY:One", "SUMMARY:One\r\nRRULE:FREQ=DAILY"),
      data.replace("VERSION:2.0", "VERSION:2.0\r\nMETHOD:PUBLISH"), data.replace("SUMMARY:One", "SUMMARY:Other"),
      data.replace("END:VALARM", "END:VALARM\r\nBEGIN:VALARM\r\nACTION:DISPLAY\r\nTRIGGER:-PT5M\r\nDESCRIPTION:Second\r\nEND:VALARM"),
    ]) assert.throws(() => writeCaldavAlarm(change, event, ref, { minutesBeforeStart: 25 }));
    assert.throws(() => inspectCaldavAlarm(data, event, { ...ref, etag: 'W/"weak"' }));
    assert.throws(() => inspectCaldavAlarm(data, event, { ...ref, icalUid: "another" }));
  }
  console.log("CalDAV alarms: narrow forms, exact byte preservation, elapsed limits, unsupported refusal: OK");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
