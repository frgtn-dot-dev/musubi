import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { EventSchema } from "@musubi/types";
import { setAllDayAdditionalDate } from "@musubi/calendar";
import { normalizeCaldavResource } from "./caldav_time";
process.env.DATABASE_URL ??= "postgres://user:pass@localhost:5432/test";
process.env.ENVIRONMENT ??= "test";
process.env.BETTER_AUTH_URL ??= "http://localhost:7531";
async function main() {
  const { prepareCaldavSeriesWrite } = await import("./caldav");
  const { caldavSeriesEvidence } = await import("./caldav_series");
  const { caldavSeriesDesired } = await import("@musubi/db");
  const raw = ["BEGIN:VCALENDAR", "VERSION:2.0", "BEGIN:VEVENT", "UID:additional-date", "DTSTART;VALUE=DATE:20260328", "DTEND;VALUE=DATE:20260329", "RRULE:FREQ=DAILY;COUNT=2", "SUMMARY:Keep original", "X-PRIVATE:Keep folded", " extension", "BEGIN:VALARM", "ACTION:DISPLAY", "TRIGGER:-PT15M", "DESCRIPTION:Keep alarm", "END:VALARM", "END:VEVENT", "END:VCALENDAR", ""].join("\r\n");
  const ref = { externalEventId: "https://dav.example/calendar/rdate.ics", etag: '"before"', icalUid: "additional-date" };
  const [parsed] = normalizeCaldavResource({ url: ref.externalEventId, etag: ref.etag, data: raw });
  const master = EventSchema.parse({ ...parsed, id: randomUUID(), revision: 1, creatorID: "owner", organizer: "", color: "red", calendars: ["calendar"], originCalendarID: "calendar" });
  const baseline = { ref, master, children: [] };
  const recurrence = setAllDayAdditionalDate(master, "2026-04-02");
  const added = prepareCaldavSeriesWrite(caldavSeriesEvidence(raw, baseline), baseline, { recurrence });
  assert.equal(added.after, raw.replace("END:VEVENT", "RDATE;VALUE=DATE:20260402\r\nEND:VEVENT"));
  assert.equal(caldavSeriesDesired(JSON.parse(JSON.stringify(added))).master.recurrence, recurrence);
  const afterBaseline = { ...baseline, master: { ...master, recurrence } };
  const removed = prepareCaldavSeriesWrite(caldavSeriesEvidence(added.after, afterBaseline), afterBaseline, { recurrence: master.recurrence });
  assert.equal(removed.after, raw);
  for (const extra of [{ patch: { recurrence, title: "Other" } }, { baseline: { ...baseline, children: [master] } }, { targetEventID: master.id }, { time: { kind: "all-day" as const, startDate: "2026-03-28", endDate: "2026-03-28" } }]) assert.throws(() => caldavSeriesDesired({ ...added, ...extra }));
  for (const value of ["202604020", "20260230", "20260402,20260402"]) {
    const malformed = added.after.replace("RDATE;VALUE=DATE:20260402", `RDATE;VALUE=DATE:${value}`);
    assert.throws(() => prepareCaldavSeriesWrite(caldavSeriesEvidence(malformed, afterBaseline), afterBaseline, { recurrence: master.recurrence }));
  }
  // Same projected set: raw multiplicity must still refuse a duplicate property.
  const duplicate = added.after.replace("SUMMARY:Keep original", "RDATE;VALUE=DATE:20260402\r\nSUMMARY:Keep original");
  const duplicateEvidence = caldavSeriesEvidence(duplicate, afterBaseline);
  assert.throws(() => prepareCaldavSeriesWrite(duplicateEvidence, afterBaseline, { recurrence: master.recurrence }));
  console.log("CalDAV RDATE serializer: reversible single DATE, untouched physical bytes, immutable delta and raw duplicate/malformed refusal: OK");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
