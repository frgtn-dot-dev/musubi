import assert from "node:assert/strict";
import { EventSchema } from "@musubi/types";
import { normalizeCaldavResource } from "./caldav_time";
process.env.DATABASE_URL ??= "postgres://user:pass@localhost:5432/test";
process.env.ENVIRONMENT ??= "test";
process.env.BETTER_AUTH_URL ??= "http://localhost:7531";
async function main() {
  const { inspectCaldavAlarm, writeCaldavAlarm, withoutCaldavAlarm } = await import("./caldav_alarms");
  const ref = { externalEventId: "https://dav.example/calendar/one.ics", etag: '"one"', icalUid: "one" };
  for (const kind of ["zoned", "all-day"]) {
    const data = ["BEGIN:VCALENDAR", "VERSION:2.0", "X-CUSTOM:root", "BEGIN:VEVENT", "UID:one", kind === "zoned" ? "DTSTART;TZID=Europe/Prague:20260329T090000" : "DTSTART;VALUE=DATE:20260329", kind === "zoned" ? "DTEND;TZID=Europe/Prague:20260329T100000" : "DTEND;VALUE=DATE:20260330", "SUMMARY:One", "X-PRIVATE:untouched", " continuation", "BEGIN:VALARM", "ACTION:DISPLAY", "TRIGGER;RELATED=START:-PT15M", "DESCRIPTION:Private folded", " description", "END:VALARM", "END:VEVENT", "END:VCALENDAR", ""].join("\r\n");
    const normalized = normalizeCaldavResource({ url: ref.externalEventId, etag: ref.etag, data })[0];
    const event = EventSchema.parse({ ...normalized, id: "one", revision: 1, creatorID: "fixture", organizer: "", color: "red", calendars: ["calendar"], originCalendarID: "calendar" });
    assert.equal(inspectCaldavAlarm(data, event, ref).alarms.minutesBeforeStart, 15);
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
