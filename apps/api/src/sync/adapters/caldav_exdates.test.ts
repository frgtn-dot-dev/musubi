import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { EventSchema } from "@musubi/types";
import { restoreAllDayExclusion } from "@musubi/calendar";
import { normalizeCaldavResource } from "./caldav_time";
process.env.DATABASE_URL ??= "postgres://user:pass@localhost:5432/test";
process.env.ENVIRONMENT ??= "test";
process.env.BETTER_AUTH_URL ??= "http://localhost:7531";
async function main() {
  const { prepareCaldavSeriesWrite } = await import("./caldav");
  const { caldavSeriesEvidence } = await import("./caldav_series");
  const { caldavSeriesDesired } = await import("@musubi/db");
  const raw = ["BEGIN:VCALENDAR", "VERSION:2.0", "BEGIN:VEVENT", "UID:excluded-dates", "DTSTART;VALUE=DATE:20260328", "DTEND;VALUE=DATE:20260329", "RRULE:FREQ=DAILY;COUNT=4", "EXDATE;VALUE=DATE:20260329,", " 20260330", "SUMMARY:Keep original", "EXDATE;VALUE=DATE:2026", " 0331", "X-PRIVATE;LANGUAGE=cs:Keep folded", " extension", "BEGIN:VALARM", "ACTION:DISPLAY", "TRIGGER:-PT15M", "DESCRIPTION:Private alarm", "END:VALARM", "END:VEVENT", "END:VCALENDAR", ""].join("\r\n");
  const ref = { externalEventId: "https://dav.example/calendar/exdates.ics", etag: '"before"', icalUid: "excluded-dates" };
  const [parsed] = normalizeCaldavResource({ url: ref.externalEventId, etag: ref.etag, data: raw });
  const master = EventSchema.parse({ ...parsed, id: randomUUID(), revision: 1, creatorID: "owner", organizer: "", color: "red", calendars: ["calendar"], originCalendarID: "calendar" });
  const baseline = { ref, master, children: [] };
  const recurrence = restoreAllDayExclusion(master.recurrence!, "2026-03-29");
  const saved = prepareCaldavSeriesWrite(caldavSeriesEvidence(raw, baseline), baseline, { recurrence });
  assert.equal(saved.after, raw.replace("EXDATE;VALUE=DATE:20260329,\r\n 20260330\r\n", "EXDATE;VALUE=DATE:20260330\r\n"));
  assert.equal(caldavSeriesDesired(JSON.parse(JSON.stringify(saved))).master.recurrence, recurrence);
  for (const extra of [{ patch: { recurrence, title: "Other change" } }, { baseline: { ...baseline, children: [master] } }, { targetEventID: master.id }, { time: { kind: "all-day" as const, startDate: "2026-03-28", endDate: "2026-03-28" } }]) assert.throws(() => caldavSeriesDesired({ ...saved, ...extra }));
  const { restoreEventExdates } = await import("./caldav_event_ical");
  for (const invalid of ["202603300", "2026033", "20260230", "20260229", "20260330,20260330"]) {
    const malformed = raw.replace("20260329,\r\n 20260330", `20260329,${invalid}`);
    assert.throws(() => restoreEventExdates(malformed, 0, ["2026-03-29"]), invalid);
  }
  const separateRaw = raw.replace("EXDATE;VALUE=DATE:20260329,\r\n 20260330", "EXDATE;VALUE=DATE:20260329\r\nEXDATE;VALUE=DATE:20260330");
  const [separateParsed] = normalizeCaldavResource({ url: ref.externalEventId, etag: ref.etag, data: separateRaw });
  const separateBaseline = { ...baseline, master: { ...master, recurrence: separateParsed.recurrence } };
  const separateRecurrence = restoreAllDayExclusion(separateBaseline.master.recurrence!, "2026-03-29");
  const duplicateProperty = separateRaw.replace("SUMMARY:Keep original", "EXDATE;VALUE=DATE:20260330\r\nSUMMARY:Keep original");
  // The existing projection accepts the identical repeated line. Only raw
  // multiplicity validation may reject this otherwise unchanged evidence.
  const duplicateEvidence = caldavSeriesEvidence(duplicateProperty, separateBaseline);
  assert.throws(() => prepareCaldavSeriesWrite(duplicateEvidence, separateBaseline, { recurrence: separateRecurrence }));
  const truncated = raw.replace("20260329,\r\n 20260330", "20260329,202603300");
  assert.throws(() => prepareCaldavSeriesWrite(caldavSeriesEvidence(truncated, baseline), baseline, { recurrence }));
  console.log("CalDAV EXDATE serializer: selected folded DATE values, exact untouched spans and immutable subset proof: OK");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
