import assert from "node:assert/strict";
import { EventSchema } from "@musubi/types";
import { resolveEventTimeEdit, expandRecurringEvents, unambiguousCivilToInstant } from "@musubi/calendar";
import { graphTimeForEvent, graphMasterTimeFromUtc } from "./microsoft_time";
import { graphRecurrenceForEvent, recurrenceFromGraph } from "./microsoft_recurrence";

const base = EventSchema.parse({ id: "00000000-0000-4000-8000-000000000181", revision: 1, creatorID: "owner", organizer: "", title: "Pattern", color: "red", calendars: [], isCanceled: false, recurrence: "RRULE:FREQ=DAILY;COUNT=4", ...resolveEventTimeEdit({ kind: "zoned", timeZone: "Europe/Prague", startLocal: "2026-03-27T09:00:00", endLocal: "2026-03-27T10:00:00" }) });
const native = { type: "seriesMaster", isAllDay: false, isCancelled: false, originalStartTimeZone: "Europe/Prague", originalEndTimeZone: "Europe/Prague", start: { dateTime: "2026-03-27T08:00:00.0000000", timeZone: "UTC" }, end: { dateTime: "2026-03-27T09:00:00.0000000", timeZone: "UTC" }, recurrence: { pattern: { type: "daily", interval: 1 }, range: { type: "numbered", startDate: "2026-03-27", numberOfOccurrences: 4, recurrenceTimeZone: "Europe/Prague" } } };
const original = JSON.stringify(native);
for (const host of ["UTC", "America/New_York", "Asia/Tokyo"]) {
  const old = process.env.TZ;
  try {
    process.env.TZ = host;
    assert.deepEqual(graphMasterTimeFromUtc(native), { start: base.start, end: base.end, isAllDay: false, timeModel: base.timeModel });
    const master = { ...base, ...graphMasterTimeFromUtc(native) };
    const recurrence = recurrenceFromGraph(master, native.recurrence);
    assert.deepEqual(expandRecurringEvents([{ ...master, recurrence }], new Date("2026-03-26Z"), new Date("2026-04-01Z"), { consumerTimeZone: "Asia/Tokyo" }).map(event => event.start.toISOString()), ["2026-03-27T08:00:00.000Z", "2026-03-28T08:00:00.000Z", "2026-03-29T07:00:00.000Z", "2026-03-30T07:00:00.000Z"]);
    assert.deepEqual(graphTimeForEvent(master), { isAllDay: false, start: { dateTime: "2026-03-27T09:00:00.000", timeZone: "Europe/Prague" }, end: { dateTime: "2026-03-27T10:00:00.000", timeZone: "Europe/Prague" } });
  } finally { if (old === undefined) delete process.env.TZ; else process.env.TZ = old; }
}
assert.equal(JSON.stringify(native), original);
const allDay = { ...native, isAllDay: true, originalStartTimeZone: "UTC", originalEndTimeZone: "UTC", start: { dateTime: "2026-12-31T00:00:00", timeZone: "UTC" }, end: { dateTime: "2027-01-03T00:00:00", timeZone: "UTC" }, recurrence: { ...native.recurrence, range: { type: "numbered", startDate: "2026-12-31", numberOfOccurrences: 4 } } };
assert.deepEqual(graphMasterTimeFromUtc(allDay), { start: new Date("2026-12-31Z"), end: new Date("2027-01-02Z"), isAllDay: true, timeModel: { kind: "all-day" } });
assert.equal(graphTimeForEvent(graphMasterTimeFromUtc(allDay)).end.dateTime, "2027-01-03T00:00:00.000");
for (const fraction of ["1", "123", "1230000"]) assert.equal(graphMasterTimeFromUtc({ ...native, start: { ...native.start, dateTime: `2026-03-27T08:00:00.${fraction}` } }).start.getUTCMilliseconds(), fraction === "1" ? 100 : 123);
for (const change of [
  { type: "occurrence" }, { type: "exception" }, { type: "singleInstance" }, { type: undefined }, { isAllDay: undefined }, { isCancelled: true }, { isCancelled: undefined },
  { seriesMasterId: "parent" }, { originalStart: "2026-03-27T08:00:00Z" },
  { originalStartTimeZone: "Central Europe Standard Time" }, { originalEndTimeZone: "America/New_York" },
  { start: { ...native.start, timeZone: "Europe/Prague" } }, { end: { ...native.end, timeZone: undefined } },
  { end: { ...native.end, dateTime: "2026-03-27T07:00:00" } },
  { recurrence: null }, { recurrence: { range: {} } },
  { recurrence: { range: { recurrenceTimeZone: "Central Europe Standard Time" } } },
  { recurrence: { range: { recurrenceTimeZone: "tzone://Microsoft/Custom" } } },
]) assert.throws(() => graphMasterTimeFromUtc({ ...native, ...change }));
for (const dateTime of ["2026-02-30T08:00:00", "2026-03-27T24:00:00", "2026-03-27T08:00:00Z", "2026-03-27T08:00:00+01:00", "2026-03-27T08:00:00.1230001", "2026-03-27T08:00:00.00000000", "not-a-date"]) assert.throws(() => graphMasterTimeFromUtc({ ...native, start: { ...native.start, dateTime } }));
for (const change of [
  { start: { ...allDay.start, dateTime: "2026-12-31T01:00:00" } }, { end: allDay.start },
  { originalStartTimeZone: "Europe/Prague" }, { recurrence: { range: { recurrenceTimeZone: "Europe/Prague" } } },
]) assert.throws(() => graphMasterTimeFromUtc({ ...allDay, ...change }));
for (const [zone, local] of [["Europe/Prague", "2026-03-29T02:30:00"], ["Europe/Prague", "2026-10-25T02:30:00"], ["Australia/Lord_Howe", "2026-04-05T01:45:00"], ["Australia/Lord_Howe", "2026-10-04T02:15:00"], ["Pacific/Apia", "2011-12-30T12:00:00"]]) {
  assert.throws(() => unambiguousCivilToInstant(local!, zone!));
  const event = { ...base, ...resolveEventTimeEdit({ kind: "zoned", timeZone: zone!, startLocal: local!, endLocal: local! }) };
  assert.throws(() => graphTimeForEvent(event));
  assert.throws(() => graphRecurrenceForEvent(event));
}
for (const start of ["2026-10-25T00:30:00", "2026-10-25T01:30:00"]) assert.throws(() => graphMasterTimeFromUtc({ ...native, start: { ...native.start, dateTime: start }, end: { ...native.end, dateTime: "2026-10-25T03:00:00" } }));
for (const change of [
  { start: new Date(base.start.getTime() + 1) }, { end: new Date(base.end.getTime() + 1) }, { start: new Date(NaN) },
  { isAllDay: true }, { timeModel: null }, { timeModel: { kind: "legacy-unknown" as const } },
  resolveEventTimeEdit({ kind: "floating", startLocal: "2026-03-27T09:00:00", endLocal: "2026-03-27T10:00:00" }),
]) { assert.throws(() => graphTimeForEvent({ ...base, ...change })); assert.throws(() => graphRecurrenceForEvent({ ...base, ...change })); }
assert.throws(() => graphTimeForEvent({ ...graphMasterTimeFromUtc(allDay), start: new Date("2026-12-31T01:00:00Z") }));
console.log("Graph master time: explicit UTC projection, exact native zone, civil serialization, inclusive all-day dates, independent DST expansion, gaps/folds and precision refusals: OK");
